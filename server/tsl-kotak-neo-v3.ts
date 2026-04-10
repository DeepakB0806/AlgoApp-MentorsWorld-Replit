import type { IStorage } from "./storage";
import type { StrategyTrade } from "@shared/schema";

// ⚠️ SPECIAL INSTRUCTION: NO AI OR DEVELOPER IS PERMITTED TO UNLOCK, MODIFY, OR TAMPER WITH ANY 🔒 LOCKED BLOCK WITHOUT EXPLICIT, PRIOR AUTHORIZATION FROM THE USER.
// ⚠️ CODING RULE: Any task that requires modifying a 🔒 LOCKED BLOCK MUST (a) explicitly name the locked block in the task description, and (b) obtain the user's written permission before the block is opened. No exceptions.
//
// 📋 TSL PERMANENT INVARIANTS — rules established through production incidents; never reverse without user sign-off:
//   [TSL-1] processTick has separate BUY/SELL direction branches — never unify. BUY trails high, SELL trails low.
//   [TSL-2] registerNewTrail initializes highWaterMark from trade.highWaterMark ?? (trade.ltp || trade.price || 0) — not just trade.price.
//   [TSL-3] flushDirtyTrails persists only dirty states. WS stale detection log must remain.

const LOG_PREFIX = "[TSL]";
const FLUSH_INTERVAL_MS = 15_000;
const WS_STALE_MS = 2_000;

interface TslState {
  tradeId: string;
  symbol: string;
  action: string;
  currentSlPrice: number;
  highWaterMark: number;
  trailingStep: number;
  planId: string;
  dirty: boolean;
}

const trails = new Map<string, TslState>();
let lastWsTickAt: number = 0;
let _storage: IStorage | null = null;
let _closeTradeById: ((storage: IStorage, tradeId: string) => Promise<void>) | null = null;

export function updateLastWsTick(): void {
  lastWsTickAt = Date.now();
}

// 🔒 LOCKED BLOCK START — TSL processTick: BUY/SELL direction branches must remain separate; BUY trails high, SELL trails low [TSL-1]
export function processTick(symbol: string, ltp: number): void {
  for (const [tradeId, state] of trails) {
    if (state.symbol !== symbol) continue;

    const isBuy = state.action === "BUY";

    if (isBuy) {
      if (ltp > state.highWaterMark) {
        state.highWaterMark = ltp;
        state.currentSlPrice = ltp - state.trailingStep;
        state.dirty = true;
      }
      if (ltp <= state.currentSlPrice) {
        console.log(`${LOG_PREFIX} SL breach BUY trade ${tradeId}: ltp=${ltp} sl=${state.currentSlPrice}`);
        trails.delete(tradeId);
        if (_storage && _closeTradeById) {
          _closeTradeById(_storage, tradeId).catch(err =>
            console.error(`${LOG_PREFIX} closeTradeById error for ${tradeId}:`, err)
          );
        }
      }
    } else {
      if (ltp < state.highWaterMark) {
        state.highWaterMark = ltp;
        state.currentSlPrice = ltp + state.trailingStep;
        state.dirty = true;
      }
      if (ltp >= state.currentSlPrice) {
        console.log(`${LOG_PREFIX} SL breach SELL trade ${tradeId}: ltp=${ltp} sl=${state.currentSlPrice}`);
        trails.delete(tradeId);
        if (_storage && _closeTradeById) {
          _closeTradeById(_storage, tradeId).catch(err =>
            console.error(`${LOG_PREFIX} closeTradeById error for ${tradeId}:`, err)
          );
        }
      }
    }
  }
}
// 🔒 LOCKED BLOCK END

// 🔒 LOCKED BLOCK START — TSL registerNewTrail: highWaterMark must init from trade.highWaterMark ?? (ltp || price || 0), not just price [TSL-2]
export function registerNewTrail(trade: StrategyTrade): void {
  if (!trade.initialSlPrice || !trade.trailingStep) return;
  const isBuy = trade.action === "BUY";
  trails.set(trade.id, {
    tradeId: trade.id,
    symbol: trade.tradingSymbol,
    action: trade.action,
    currentSlPrice: trade.currentSlPrice ?? trade.initialSlPrice,
    highWaterMark: trade.highWaterMark ?? (trade.ltp || trade.price || 0),
    trailingStep: trade.trailingStep,
    planId: trade.planId,
    dirty: false,
  });
  console.log(`${LOG_PREFIX} Registered trail for ${trade.tradingSymbol} [${isBuy ? "BUY" : "SELL"}] sl=${trade.currentSlPrice}`);
}
// 🔒 LOCKED BLOCK END

// 🔒 LOCKED BLOCK START — TSL flushDirtyTrails: persists dirty states only; WS stale detection log must remain [TSL-3]
async function flushDirtyTrails(): Promise<void> {
  if (!_storage) return;

  if (lastWsTickAt > 0 && Date.now() - lastWsTickAt > WS_STALE_MS) {
    console.log(`${LOG_PREFIX} WS stale (${Math.round((Date.now() - lastWsTickAt) / 1000)}s), using REST fallback`);
  }

  for (const [tradeId, state] of trails) {
    if (!state.dirty) continue;
    try {
      await _storage.updateStrategyTrade(tradeId, {
        currentSlPrice: state.currentSlPrice,
        highWaterMark: state.highWaterMark,
        updatedAt: new Date().toISOString(),
      });
      state.dirty = false;
    } catch (err) {
      console.error(`${LOG_PREFIX} DB flush error for trade ${tradeId}:`, err);
    }
  }
}
// 🔒 LOCKED BLOCK END

export async function startTslEngine(
  storage: IStorage,
  closeTradeById: (storage: IStorage, tradeId: string) => Promise<void>,
): Promise<void> {
  _storage = storage;
  _closeTradeById = closeTradeById;

  try {
    const openTrades = await storage.getOpenNrmlTradesWithTsl();
    for (const trade of openTrades) {
      registerNewTrail(trade);
    }
    console.log(`${LOG_PREFIX} Rehydrated ${openTrades.length} active trail(s)`);
  } catch (err) {
    console.error(`${LOG_PREFIX} Rehydration error:`, err);
  }

  setInterval(flushDirtyTrails, FLUSH_INTERVAL_MS);
  console.log(`${LOG_PREFIX} TSL Engine started`);
}
