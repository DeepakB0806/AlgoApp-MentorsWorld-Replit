import type { IStorage } from "./storage";
import type { StrategyPlan, StrategyTrade } from "@workspace/db";
import { getPrice } from "./md-kotak-neo-v3";
import { startPersistentSquareOff, persistentSquareOffActive, parseTradeParams } from "./te-kotak-neo-v3";
import { brokerSymbolToTokenMap } from "./smc-kotak-neo-v3";
import { addProcessFlowLog } from "./process-flow-log";
import EL from "./el-kotak-neo-v3";
import { isWithinMarketHours, getISTDatetimeNow } from "./market-calendar";

const LOG_PREFIX = "[MTM-MONITOR]";
const TICK_INTERVAL_MS = 5_000;


function resolveThreshold(value: number, mode: string, capital: number): number {
  if (mode === "percentage") return (capital * value) / 100;
  return value;
}

async function computePlanMTM(
  trades: StrategyTrade[],
  storage: IStorage,
  planBrokerConfigId: string | null | undefined,
  planId: string,
): Promise<{ mtm: number; capital: number }> {
  const bc = planBrokerConfigId ? await storage.getBrokerConfig(planBrokerConfigId) : undefined;
  let mtm = 0;
  let capital = 0;

  for (const trade of trades) {
    const entryPrice = trade.price ?? 0;
    const qty = trade.quantity ?? 0;

    // Build #253 — MTM sanity guard: skip legs where entryPrice looks like an index spot price,
    // not an option premium. NFO/BFO options are never priced above ₹5,000 per lot at entry.
    // This protects against wrong fill prices stored from the ctx.price fallback (e.g. ₹23,624).
    const exch = (trade.exchange ?? "").toUpperCase();
    if ((exch === "NFO" || exch === "BFO") && entryPrice > 5000) {
      console.warn(`${LOG_PREFIX} WARN: skipping ${trade.tradingSymbol} — entry price ₹${entryPrice} looks like index spot, not option premium (tradeId=${trade.id})`);
      continue;
    }

    // Build #272 — MTM sanity guard: skip legs where entryPrice is 0 — fill was unconfirmed due to
    // session/auth error at entry time. These trades are open for manual review; skipping them here
    // prevents false SL/profit-target triggers on a position whose real fill price is unknown.
    if ((exch === "NFO" || exch === "BFO") && entryPrice === 0) {
      console.warn(`${LOG_PREFIX} WARN: skipping ${trade.tradingSymbol} — entry price is ₹0 (fill unconfirmed — requires manual review) (tradeId=${trade.id})`);
      continue;
    }

    capital += entryPrice * qty;

    const token = brokerSymbolToTokenMap.get(trade.tradingSymbol);
    const ltp = bc
      ? await getPrice(trade.tradingSymbol, bc, EL.mapExchange(trade.exchange ?? "NFO"), token)
      : null;

    if (ltp === null) continue;

    const legMTM = trade.action === "BUY"
      ? (ltp - entryPrice) * qty
      : (entryPrice - ltp) * qty;
    mtm += legMTM;
  }

  return { mtm, capital };
}

async function runMtmCycle(storage: IStorage): Promise<void> {
  const { time: istTime, date: istDate } = getISTDatetimeNow();

  // ── Part B: Plan-level MTM stoploss + profit target check ─────────────────
  try {
    const allPlans = await storage.getStrategyPlans();
    const deployedPlans = allPlans.filter(
      (p) => (p.deploymentStatus === "active" || p.deploymentStatus === "deployed") && p.brokerConfigId
    );

    const mtmMarketHoursCache = new Map<string, boolean>();
    for (const plan of deployedPlans) {
      try {
        if (persistentSquareOffActive.has(plan.id)) continue;

        const planExchange = plan.exchange || "NFO";
        if (!mtmMarketHoursCache.has(planExchange)) {
          mtmMarketHoursCache.set(planExchange, await isWithinMarketHours(storage, planExchange, istTime, istDate));
        }
        if (!mtmMarketHoursCache.get(planExchange)) continue;

        // #264: read SL/PT from schema columns; fall back to trade_params JSON for unmigrated plans
        const slEnabled = plan.stoplossEnabled === true && (plan.stoplossValue ?? 0) > 0;
        const ptEnabled = plan.profitTargetEnabled === true && (plan.profitTargetValue ?? 0) > 0;
        let stoplossEnabled = slEnabled;
        let stoplossValue = plan.stoplossValue ?? 0;
        let stoplossMode = plan.stoplossMode ?? "amount";
        let profitEnabled = ptEnabled;
        let profitTargetValue = plan.profitTargetValue ?? 0;
        let profitTargetMode = plan.profitTargetMode ?? "amount";

        if (!stoplossEnabled && !profitEnabled) {
          const tp = parseTradeParams(plan);
          if (!tp) continue;
          stoplossEnabled = tp.stoploss?.enabled === true && (tp.stoploss?.value ?? 0) > 0;
          stoplossValue = tp.stoploss?.value ?? 0;
          stoplossMode = tp.stoploss?.mode ?? "amount";
          profitEnabled = tp.profitTarget?.enabled === true && (tp.profitTarget?.value ?? 0) > 0;
          profitTargetValue = tp.profitTarget?.value ?? 0;
          profitTargetMode = tp.profitTarget?.mode ?? "amount";
        }

        if (!stoplossEnabled && !profitEnabled) continue;

        const unclosedTrades = await storage.getUnclosedTradesByPlan(plan.id);
        if (unclosedTrades.length === 0) continue;

        const { mtm, capital } = await computePlanMTM(unclosedTrades, storage, plan.brokerConfigId, plan.id);

        if (stoplossEnabled) {
          const slThreshold = resolveThreshold(stoplossValue, stoplossMode, capital);
          if (mtm <= -slThreshold) {
            const bc = await storage.getBrokerConfig(plan.brokerConfigId!);
            if (!bc) continue;
            console.log(`${LOG_PREFIX} MTM stoploss breached for plan "${plan.name}" — MTM=${mtm.toFixed(0)}, threshold=-${slThreshold.toFixed(0)}`);
            addProcessFlowLog({
              planId: plan.id,
              planName: plan.name,
              signalType: "square_off",
              alert: "MTM stoploss triggered",
              resolvedAction: "CLOSE",
              blockType: "mtm_monitor",
              actionTaken: "auto_square_off",
              message: `MTM stoploss: plan MTM ${mtm.toFixed(0)} ≤ -${slThreshold.toFixed(0)} (${stoplossMode} ${stoplossValue}). Persistent exit started.`,
              broker: bc.brokerName,
            });
            startPersistentSquareOff(storage, plan.id, bc);
            continue;
          }
        }

        if (profitEnabled) {
          const ptThreshold = resolveThreshold(profitTargetValue, profitTargetMode, capital);
          if (mtm >= ptThreshold) {
            const bc = await storage.getBrokerConfig(plan.brokerConfigId!);
            if (!bc) continue;
            console.log(`${LOG_PREFIX} MTM profit target reached for plan "${plan.name}" — MTM=${mtm.toFixed(0)}, threshold=${ptThreshold.toFixed(0)}`);
            addProcessFlowLog({
              planId: plan.id,
              planName: plan.name,
              signalType: "square_off",
              alert: "MTM profit target triggered",
              resolvedAction: "CLOSE",
              blockType: "mtm_monitor",
              actionTaken: "auto_square_off",
              message: `MTM profit target: plan MTM ${mtm.toFixed(0)} ≥ ${ptThreshold.toFixed(0)} (${profitTargetMode} ${profitTargetValue}). Persistent exit started.`,
              broker: bc.brokerName,
            });
            startPersistentSquareOff(storage, plan.id, bc);
          }
        }
      } catch (err: any) {
        console.error(`${LOG_PREFIX} Error checking plan "${plan.name}" (${plan.id}):`, err?.message || err);
      }
    }
  } catch (err: any) {
    console.error(`${LOG_PREFIX} MTM cycle error:`, err?.message || err);
  }
}

export function startMtmMonitor(storage: IStorage): void {
  console.log(`${LOG_PREFIX} MTM Monitor started — ticking every 5 seconds`);
  setInterval(async () => {
    try {
      await runMtmCycle(storage);
    } catch (err: any) {
      console.error(`${LOG_PREFIX} Tick error:`, err?.message || err);
    }
  }, TICK_INTERVAL_MS);
}
