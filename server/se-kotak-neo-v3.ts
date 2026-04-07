import type { IStorage } from "./storage";

const LOG_PREFIX = "[SE]";
const SWEEP_INTERVAL_MS = 10_000;

export function startSettlementEngine(storage: IStorage): void {
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

  console.log(`${LOG_PREFIX} Settlement Engine started`);
}
