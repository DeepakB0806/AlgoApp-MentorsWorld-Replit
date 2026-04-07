import type { IStorage } from "./storage";
import type { TimeLogicConfig, TradeParams } from "@shared/schema";
import { startPersistentSquareOff, persistentSquareOffActive } from "./te-kotak-neo-v3";
import { addProcessFlowLog } from "./process-flow-log";
import { processTick } from "./tsl-kotak-neo-v3";
import { getPrice } from "./md-kotak-neo-v3";
import { brokerSymbolToTokenMap } from "./smc-kotak-neo-v3";
import EL from "./el-kotak-neo-v3";

const LOG_PREFIX = "[PLAN-MONITOR]";
const CHECK_INTERVAL_MS = 60 * 1000;

function getISTDatetime(): { date: string; time: string; dayName: string } {
  const istDate = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const dayName = days[istDate.getDay()];
  const yy = istDate.getFullYear();
  const mm = String(istDate.getMonth() + 1).padStart(2, "0");
  const dd = String(istDate.getDate()).padStart(2, "0");
  const hh = String(istDate.getHours()).padStart(2, "0");
  const min = String(istDate.getMinutes()).padStart(2, "0");
  return {
    date: `${yy}-${mm}-${dd}`,
    time: `${hh}:${min}`,
    dayName,
  };
}

function parseTimeLogic(tradeParamsJson: string | null | undefined): TimeLogicConfig | null {
  if (!tradeParamsJson) return null;
  try {
    const tp: TradeParams = JSON.parse(tradeParamsJson);
    return tp.timeLogic || null;
  } catch {
    return null;
  }
}

export function startPlanMonitor(storage: IStorage): void {
  console.log(`${LOG_PREFIX} Plan monitor started — checking every 60 seconds`);
  setInterval(async () => {
    try {
      await checkPlans(storage);
    } catch (err: any) {
      console.error(`${LOG_PREFIX} Tick error:`, err?.message || err);
    }
  }, CHECK_INTERVAL_MS);
}

async function checkPlans(storage: IStorage): Promise<void> {
  const { time: istTime, dayName: istDayName } = getISTDatetime();

  if (istTime < "09:00" || istTime > "16:00") return;

  const allPlans = await storage.getStrategyPlans();
  const deployedPlans = allPlans.filter(
    (p) => (p.deploymentStatus === "active" || p.deploymentStatus === "deployed") && p.brokerConfigId
  );

  // Loop is a no-op when empty; TSL poll still runs regardless of deployed plan count
  for (const plan of deployedPlans) {
    try {
      if (persistentSquareOffActive.has(plan.id)) continue;

      const timeLogic = parseTimeLogic(plan.tradeParams);
      if (!timeLogic) continue;

      const { exitTime, exitOnExpiry } = timeLogic;

      // Fetch unclosed trades first — productType from DB drives the gate logic,
      // not the plan config JSON. Each trade stores what was actually placed.
      const unclosedTrades = await storage.getUnclosedTradesByPlan(plan.id);
      if (unclosedTrades.length === 0) continue;

      const hasMIS  = unclosedTrades.some(t => t.productType?.toUpperCase() === "MIS");
      const hasNRML = unclosedTrades.some(t => ["NRML", "CNC"].includes(t.productType?.toUpperCase() ?? ""));

      let shouldSquareOff = false;
      let reason = "";

      // exitTime applies ONLY to MIS positions — broker forces intraday close anyway
      if (exitTime && hasMIS && istTime >= exitTime) {
        shouldSquareOff = true;
        reason = `exitTime reached for MIS position(s) (configured ${exitTime} IST, current ${istTime} IST)`;
      }

      // exitOnExpiry applies ONLY to NRML/CNC positions, and only on expiry day
      if (!shouldSquareOff && exitOnExpiry && hasNRML) {
        const ticker = plan.ticker;
        const exchange = plan.exchange || "NFO";
        if (ticker) {
          const instrConfig = await storage.getInstrumentConfig(ticker, exchange);
          const expiryDay = instrConfig?.expiryDay || "Thursday";
          if (istDayName === expiryDay) {
            const squareOffTime = exitTime || "15:20";
            if (istTime >= squareOffTime) {
              shouldSquareOff = true;
              reason = `exitOnExpiry — today is ${expiryDay} (expiry day for ${ticker}), time ${istTime} >= ${squareOffTime} IST`;
            }
          }
        }
      }

      if (!shouldSquareOff) continue;

      const brokerConfig = await storage.getBrokerConfig(plan.brokerConfigId!);
      if (!brokerConfig) {
        console.warn(
          `${LOG_PREFIX} Plan "${plan.name}" — broker config ${plan.brokerConfigId} not found, skipping`
        );
        addProcessFlowLog({
          planId: plan.id,
          planName: plan.name,
          signalType: "square_off",
          alert: "Auto square-off",
          resolvedAction: "CLOSE",
          blockType: "plan_monitor",
          actionTaken: "error",
          message: `Auto square-off skipped — broker config not found (${plan.brokerConfigId})`,
          broker: "unknown",
        });
        continue;
      }

      console.log(
        `${LOG_PREFIX} Plan "${plan.name}" (${plan.id}) — ${reason} — starting persistent exit for ${unclosedTrades.length} unclosed trade(s)`
      );

      addProcessFlowLog({
        planId: plan.id,
        planName: plan.name,
        signalType: "square_off",
        alert: "Auto square-off triggered",
        resolvedAction: "CLOSE",
        blockType: "plan_monitor",
        actionTaken: "auto_square_off",
        message: `Reason: ${reason}. Persistent exit started for ${unclosedTrades.length} unclosed trade(s).`,
        broker: brokerConfig.brokerName,
      });

      startPersistentSquareOff(storage, plan.id, brokerConfig);
    } catch (err: any) {
      console.error(
        `${LOG_PREFIX} Error checking plan "${plan.name}" (${plan.id}):`,
        err?.message || err
      );
    }
  }

  // TSL Poll — REST fallback: fetch live LTP for all active NRML trails and
  // push into processTick() so the engine has a price baseline even when the
  // WebSocket Scout is silent. getPrice() uses MD cache first, falls back to
  // REST quote only when cache is stale.
  try {
    const tslTrades = await storage.getOpenNrmlTradesWithTsl();
    if (tslTrades.length > 0) {
      const planConfigCache = new Map<string, Awaited<ReturnType<IStorage["getBrokerConfig"]>>>();
      for (const trade of tslTrades) {
        if (!planConfigCache.has(trade.planId)) {
          const plan = await storage.getStrategyPlan(trade.planId);
          const bc = plan?.brokerConfigId ? await storage.getBrokerConfig(plan.brokerConfigId) : undefined;
          planConfigCache.set(trade.planId, bc);
        }
        const bc = planConfigCache.get(trade.planId);
        if (!bc) continue;
        const token = brokerSymbolToTokenMap.get(trade.tradingSymbol);
        const ltp = await getPrice(trade.tradingSymbol, bc, EL.mapExchange(trade.exchange), token);
        if (ltp !== null) {
          processTick(trade.tradingSymbol, ltp);
        }
      }
    }
  } catch (err: any) {
    console.error(`${LOG_PREFIX} TSL poll error:`, err?.message || err);
  }
}
