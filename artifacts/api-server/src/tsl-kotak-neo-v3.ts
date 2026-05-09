import type { IStorage } from "./storage";
import type { BrokerConfig, StrategyTrade } from "@workspace/db";
import { getPrice } from "./md-kotak-neo-v3";
import { isWithinMarketHours, getISTDatetimeNow } from "./market-calendar";
import { brokerSymbolToTokenMap } from "./smc-kotak-neo-v3";
import EL from "./el-kotak-neo-v3";

// ⚠️ SPECIAL INSTRUCTION: NO AI OR DEVELOPER IS PERMITTED TO UNLOCK, MODIFY, OR TAMPER WITH ANY 🔒 LOCKED BLOCK WITHOUT EXPLICIT, PRIOR AUTHORIZATION FROM THE USER.
// ⚠️ CODING RULE: Any task that requires modifying a 🔒 LOCKED BLOCK MUST (a) explicitly name the locked block in the task description, and (b) obtain the user's written permission before the block is opened. No exceptions.
//
// 📋 TSL PERMANENT INVARIANTS — rules established through production incidents; never reverse without user sign-off:
//   [TSL-1] processTick has separate BUY/SELL direction branches — never unify. BUY trails high, SELL trails low.
//          Uses O(1) symbol index (trailsBySymbol) for lookup. Activation gate: trailing only begins after tslActivateAt profit threshold.
//   [TSL-2] registerNewTrail initializes highWaterMark from trade.highWaterMark ?? (trade.ltp || trade.price || 0) — not just trade.price.
//          Allows null initialSlPrice (no explicit SL needed). Reads tslActivateAt from trade record. Updates trailsBySymbol index.
//   [TSL-3] flushDirtyTrails persists only dirty states. WS stale detection log must remain.

const LOG_PREFIX = "[TSL]";
const FLUSH_INTERVAL_MS = 15_000;
const WS_STALE_MS = 2_000;
const WS_FALLBACK_THRESHOLD_MS = 30_000;
const REST_FALLBACK_INTERVAL_MS = 30_000;

interface TslState {
  tradeId: string;
  symbol: string;
  action: string;
  currentSlPrice: number;
  highWaterMark: number;
  trailingStep: number;
  planId: string;
  dirty: boolean;
  tslType: string;
  tslLockProfit: number | null;
  tslProfitStep: number | null;
  entryPrice: number;
  lockAchieved: boolean;
  tslActivateAt: number | null;
  tslActivated: boolean;
}

const trails = new Map<string, TslState>();
const trailsBySymbol = new Map<string, Set<string>>();
let lastWsTickAt: number = 0;
let lastRestFallbackAt: number = 0;
let _storage: IStorage | null = null;
let _closeTradeById: ((storage: IStorage, tradeId: string) => Promise<void>) | null = null;

export function updateLastWsTick(): void {
  lastWsTickAt = Date.now();
}

// 🔒 LOCKED BLOCK START — TSL processTick: BUY/SELL direction branches must remain separate; BUY trails high, SELL trails low [TSL-1]
export function processTick(symbol: string, ltp: number): void {
  const ids = trailsBySymbol.get(symbol);
  if (!ids || ids.size === 0) return;

  for (const tradeId of ids) {
    const state = trails.get(tradeId);
    if (!state) continue;

    if (!state.tslActivated) {
      const profit = state.action === "BUY"
        ? ltp - state.entryPrice
        : state.entryPrice - ltp;
      if (state.tslActivateAt && profit >= state.tslActivateAt) {
        state.tslActivated = true;
        state.highWaterMark = ltp;
        state.dirty = true;
        console.log(`${LOG_PREFIX} Trail activated tradeId=${tradeId} at ltp=${ltp} profit=${profit.toFixed(2)}`);
      } else {
        continue;
      }
    }

    const isBuy = state.action === "BUY";

    if (isBuy) {
      if (state.tslType !== "none") {
        const effectiveStep = state.tslType === "percentage_of_capital"
          ? state.entryPrice * (state.trailingStep / 100)
          : state.trailingStep;

        if (!state.lockAchieved && state.tslLockProfit !== null && state.tslLockProfit > 0) {
          const currentProfit = ltp - state.entryPrice;
          if (currentProfit >= state.tslLockProfit) {
            state.currentSlPrice = Math.max(state.currentSlPrice, state.entryPrice);
            state.lockAchieved = true;
            state.dirty = true;
          }
        }

        if (state.tslProfitStep !== null && state.tslProfitStep > 0) {
          if (ltp >= state.highWaterMark + state.tslProfitStep) {
            state.highWaterMark = ltp;
            state.currentSlPrice = ltp - effectiveStep;
            state.dirty = true;
          }
        } else {
          if (ltp > state.highWaterMark) {
            state.highWaterMark = ltp;
            state.currentSlPrice = ltp - effectiveStep;
            state.dirty = true;
          }
        }
      }

      if (ltp <= state.currentSlPrice) {
        console.log(`${LOG_PREFIX} SL breach BUY trade ${tradeId}: ltp=${ltp} sl=${state.currentSlPrice}`);
        trails.delete(tradeId);
        trailsBySymbol.get(state.symbol)?.delete(tradeId);
        if (_storage && _closeTradeById) {
          _closeTradeById(_storage, tradeId).catch(err =>
            console.error(`${LOG_PREFIX} closeTradeById error for ${tradeId}:`, err)
          );
        }
      }
    } else {
      if (state.tslType !== "none") {
        const effectiveStep = state.tslType === "percentage_of_capital"
          ? state.entryPrice * (state.trailingStep / 100)
          : state.trailingStep;

        if (!state.lockAchieved && state.tslLockProfit !== null && state.tslLockProfit > 0) {
          const currentProfit = state.entryPrice - ltp;
          if (currentProfit >= state.tslLockProfit) {
            state.currentSlPrice = Math.min(state.currentSlPrice, state.entryPrice);
            state.lockAchieved = true;
            state.dirty = true;
          }
        }

        if (state.tslProfitStep !== null && state.tslProfitStep > 0) {
          if (ltp <= state.highWaterMark - state.tslProfitStep) {
            state.highWaterMark = ltp;
            state.currentSlPrice = ltp + effectiveStep;
            state.dirty = true;
          }
        } else {
          if (ltp < state.highWaterMark) {
            state.highWaterMark = ltp;
            state.currentSlPrice = ltp + effectiveStep;
            state.dirty = true;
          }
        }
      }

      if (ltp >= state.currentSlPrice) {
        console.log(`${LOG_PREFIX} SL breach SELL trade ${tradeId}: ltp=${ltp} sl=${state.currentSlPrice}`);
        trails.delete(tradeId);
        trailsBySymbol.get(state.symbol)?.delete(tradeId);
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
  if (!trade.trailingStep) return;
  const isBuy = trade.action === "BUY";
  const tslActivateAt = (trade as any).tslActivateAt ?? null;
  const tslActivated = (trade as any).tslActivated ?? (!tslActivateAt || tslActivateAt <= 0);
  const hwm = trade.highWaterMark ?? (trade.ltp || trade.price || 0);
  const state: TslState = {
    tradeId: trade.id,
    symbol: trade.tradingSymbol,
    action: trade.action,
    currentSlPrice: trade.currentSlPrice ?? trade.initialSlPrice ?? (isBuy ? 0 : Infinity),
    highWaterMark: hwm,
    trailingStep: trade.trailingStep,
    planId: trade.planId,
    dirty: false,
    tslType: trade.tslType ?? "none",
    tslLockProfit: trade.tslLockProfit ?? null,
    tslProfitStep: trade.tslProfitStep ?? null,
    entryPrice: hwm,
    lockAchieved: false,
    tslActivateAt,
    tslActivated,
  };
  trails.set(trade.id, state);
  if (!trailsBySymbol.has(trade.tradingSymbol)) {
    trailsBySymbol.set(trade.tradingSymbol, new Set());
  }
  trailsBySymbol.get(trade.tradingSymbol)!.add(trade.id);
  console.log(`${LOG_PREFIX} Registered trail for ${trade.tradingSymbol} [${isBuy ? "BUY" : "SELL"}] sl=${trade.currentSlPrice ?? "null"} activateAt=${tslActivateAt ?? "immediate"}`);
}
// 🔒 LOCKED BLOCK END

async function runRestFallbackTick(): Promise<void> {
  if (!_storage || trails.size === 0) return;
  const { time: istTime, date: istDate } = getISTDatetimeNow();
  const inHours = await isWithinMarketHours(_storage, "NFO", istTime, istDate);
  if (!inHours) return;

  const openTrades = await _storage.getOpenTradesWithTsl();
  const configCache = new Map<string, BrokerConfig | undefined>();

  for (const trade of openTrades) {
    if (!trails.has(trade.id)) continue;
    if (!configCache.has(trade.planId)) {
      const plan = await _storage.getStrategyPlan(trade.planId);
      const bc = plan?.brokerConfigId ? await _storage.getBrokerConfig(plan.brokerConfigId) : undefined;
      configCache.set(trade.planId, bc);
    }
    const bc = configCache.get(trade.planId);
    if (!bc) continue;
    const token = brokerSymbolToTokenMap.get(trade.tradingSymbol);
    const exchange = EL.mapExchange((trade as any).exchange ?? "NFO");
    const ltp = await getPrice(trade.tradingSymbol, bc, exchange, token);
    if (ltp !== null) {
      processTick(trade.tradingSymbol, ltp);
    }
  }
}

// 🔒 LOCKED BLOCK START — TSL flushDirtyTrails: persists dirty states only; WS stale detection log must remain [TSL-3]
async function flushDirtyTrails(): Promise<void> {
  if (!_storage) return;

  if (lastWsTickAt > 0 && Date.now() - lastWsTickAt > WS_STALE_MS) {
    const staleMs = Date.now() - lastWsTickAt;
    console.log(`${LOG_PREFIX} WS stale (${Math.round(staleMs / 1000)}s), using REST fallback`);
    if (staleMs > WS_FALLBACK_THRESHOLD_MS && trails.size > 0 && Date.now() - lastRestFallbackAt > REST_FALLBACK_INTERVAL_MS) {
      lastRestFallbackAt = Date.now();
      console.log(`${LOG_PREFIX} WS stale — REST fallback firing`);
      runRestFallbackTick().catch(err => console.error(`${LOG_PREFIX} REST fallback error:`, err));
    }
  }

  for (const [tradeId, state] of trails) {
    if (!state.dirty) continue;
    try {
      await _storage.updateStrategyTrade(tradeId, {
        currentSlPrice: state.currentSlPrice,
        highWaterMark: state.highWaterMark,
        tslActivated: state.tslActivated,
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
    const openTrades = await storage.getOpenTradesWithTsl();
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
