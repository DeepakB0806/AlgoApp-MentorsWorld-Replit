import type { IStorage } from "./storage";
import type { TimeLogicConfig, TradeParams } from "@shared/schema";
import { squareOffPlan } from "./te-kotak-neo-v3";
import { addProcessFlowLog } from "./process-flow-log";

const LOG_PREFIX = "[PLAN-MONITOR]";
const CHECK_INTERVAL_MS = 60 * 1000;

const firedToday = new Map<string, string>();

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
  const { date: istDate, time: istTime, dayName: istDayName } = getISTDatetime();

  if (istTime < "09:00" || istTime > "16:00") return;

  const allPlans = await storage.getStrategyPlans();
  const deployedPlans = allPlans.filter(
    (p) => (p.deploymentStatus === "active" || p.deploymentStatus === "deployed") && p.brokerConfigId
  );

  if (deployedPlans.length === 0) return;

  for (const plan of deployedPlans) {
    try {
      const timeLogic = parseTimeLogic(plan.tradeParams);
      if (!timeLogic) continue;

      const { exitTime, exitOnExpiry } = timeLogic;

      if (firedToday.get(plan.id) === istDate) continue;

      let shouldSquareOff = false;
      let reason = "";

      if (exitTime && istTime >= exitTime) {
        shouldSquareOff = true;
        reason = `exitTime reached (configured ${exitTime} IST, current ${istTime} IST)`;
      }

      if (!shouldSquareOff && exitOnExpiry) {
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

      const openTrades = await storage.getOpenTradesByPlan(plan.id);

      firedToday.set(plan.id, istDate);

      if (openTrades.length === 0) {
        console.log(`${LOG_PREFIX} Plan "${plan.name}" — ${reason} — no open trades, skipping`);
        continue;
      }

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
        });
        continue;
      }

      console.log(
        `${LOG_PREFIX} Plan "${plan.name}" (${plan.id}) — ${reason} — squaring off ${openTrades.length} open trade(s)`
      );

      addProcessFlowLog({
        planId: plan.id,
        planName: plan.name,
        signalType: "square_off",
        alert: "Auto square-off triggered",
        resolvedAction: "CLOSE",
        blockType: "plan_monitor",
        actionTaken: "auto_square_off",
        message: `Reason: ${reason}. Closing ${openTrades.length} open trade(s).`,
        broker: brokerConfig.brokerName,
      });

      const result = await squareOffPlan(storage, plan.id, brokerConfig);

      console.log(
        `${LOG_PREFIX} Plan "${plan.name}" — auto square-off complete: closed=${result.closed}, failed=${result.failed}`
      );

      if (result.errors.length > 0) {
        console.error(
          `${LOG_PREFIX} Plan "${plan.name}" — errors: ${result.errors.join("; ")}`
        );
      }
    } catch (err: any) {
      console.error(
        `${LOG_PREFIX} Error checking plan "${plan.name}" (${plan.id}):`,
        err?.message || err
      );
    }
  }
}
