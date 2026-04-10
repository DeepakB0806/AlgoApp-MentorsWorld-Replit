import type { IStorage } from "./storage";

// ⚠️ SPECIAL INSTRUCTION: NO AI OR DEVELOPER IS PERMITTED TO UNLOCK, MODIFY, OR TAMPER WITH ANY 🔒 LOCKED BLOCK WITHOUT EXPLICIT, PRIOR AUTHORIZATION FROM THE USER.
// ⚠️ CODING RULE: Any task that requires modifying a 🔒 LOCKED BLOCK MUST (a) explicitly name the locked block in the task description, and (b) obtain the user's written permission before the block is opened. No exceptions.
//
// 📋 SE PERMANENT INVARIANTS — rules established through production incidents; never reverse without user sign-off:
//   [SE-1] PnL grouping key is ${planId}__${date} (double underscore) — must match for correct daily aggregation.
//   [SE-2] markTradesPnlCalculated(group.ids) must be called after upsert, not before. Reversing marks trades settled before confirming storage write.
//   [SE-3] SWEEP_INTERVAL_MS = 10_000 — 10-second sweep. Do not increase; unsettled trades accumulate between sweeps.

const LOG_PREFIX = "[SE]";
const SWEEP_INTERVAL_MS = 10_000;

export function startSettlementEngine(storage: IStorage): void {
  // 🔒 LOCKED BLOCK START — SE settlement sweep: grouping key=${planId}__${date}, upsert before markCalculated, sweep interval 10s [SE-1, SE-2, SE-3]
  setInterval(async () => {
    try {
      const unsettled = await storage.getUnsettledClosedTrades();
      if (unsettled.length === 0) return;

      const groups = new Map<string, { planId: string; date: string; pnl: number; ids: string[] }>();

      for (const trade of unsettled) {
        const date = trade.exitedAt?.split("T")[0] || new Date().toISOString().split("T")[0];
        const key = `${trade.planId}__${date}`;
        const existing = groups.get(key);
        if (existing) {
          existing.pnl += Number(trade.pnl || 0);
          existing.ids.push(trade.id);
        } else {
          groups.set(key, { planId: trade.planId, date, pnl: Number(trade.pnl || 0), ids: [trade.id] });
        }
      }

      for (const group of groups.values()) {
        try {
          const records = await storage.getStrategyDailyPnl(group.planId);
          const existing = records.find(r => r.date === group.date);
          if (existing) {
            await storage.updateStrategyDailyPnl(existing.id, {
              dailyPnl: Number(existing.dailyPnl || 0) + group.pnl,
            });
          } else {
            await storage.createStrategyDailyPnl({
              planId: group.planId,
              date: group.date,
              dailyPnl: group.pnl,
            });
          }
          await storage.markTradesPnlCalculated(group.ids);
        } catch (err) {
          console.error(`${LOG_PREFIX} Error settling planId=${group.planId} date=${group.date}:`, err);
        }
      }
    } catch (err) {
      console.error(`${LOG_PREFIX} Sweep error:`, err);
    }
  }, SWEEP_INTERVAL_MS);
  // 🔒 LOCKED BLOCK END

  console.log(`${LOG_PREFIX} Settlement Engine started`);
}
