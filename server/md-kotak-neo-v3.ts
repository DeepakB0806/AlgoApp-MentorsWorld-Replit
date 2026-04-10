import EL from "./el-kotak-neo-v3";
import type { BrokerConfig } from "@shared/schema";

// ⚠️ SPECIAL INSTRUCTION: NO AI OR DEVELOPER IS PERMITTED TO UNLOCK, MODIFY, OR TAMPER WITH ANY 🔒 LOCKED BLOCK WITHOUT EXPLICIT, PRIOR AUTHORIZATION FROM THE USER.
// ⚠️ CODING RULE: Any task that requires modifying a 🔒 LOCKED BLOCK MUST (a) explicitly name the locked block in the task description, and (b) obtain the user's written permission before the block is opened. No exceptions.
//
// 📋 MD PERMANENT INVARIANTS — rules established through production incidents; never reverse without user sign-off:
//   [MD-1] getPrice three-tier fallback: WS cache (2s staleness) → REST quote via EL.getQuote → stale cache. Never collapse tiers or remove REST fallback.
//   [MD-2] resolveHsmSubscribe uses lazy require() — not a static import. Avoids circular dependency. Never convert to module-level import.

const LOG_PREFIX = "[MD]";
const STALE_MS = 2_000;

interface PriceEntry {
  ltp: number;
  updatedAt: number;
}

const priceCache = new Map<string, PriceEntry>();

export function updatePrice(symbol: string, ltp: number): void {
  priceCache.set(symbol, { ltp, updatedAt: Date.now() });
}

export function injectPrice(symbol: string, ltp: number): void {
  priceCache.set(symbol, { ltp, updatedAt: Date.now() });
}

// 🔒 LOCKED BLOCK START — MD getPrice: three-tier fallback (WS cache → REST quote → stale cache); never collapse tiers or remove REST fallback [MD-1]
export async function getPrice(
  symbol: string,
  config?: BrokerConfig,
  exchange?: string,
  token?: string,
): Promise<number | null> {
  const cached = priceCache.get(symbol);
  if (cached && Date.now() - cached.updatedAt < STALE_MS) {
    return cached.ltp;
  }

  if (!config || !exchange || !token) {
    return cached ? cached.ltp : null;
  }

  try {
    const result = await EL.getQuote(config, exchange, token);
    if (result.success && result.ltp !== undefined) {
      priceCache.set(symbol, { ltp: result.ltp, updatedAt: Date.now() });
      return result.ltp;
    }
  } catch (err) {
    console.error(`${LOG_PREFIX} getPrice REST fallback error for ${symbol}:`, err);
  }

  return cached ? cached.ltp : null;
}
// 🔒 LOCKED BLOCK END

let _cachedHsmSubscribe: ((symbol: string) => void) | null = null;

// 🔒 LOCKED BLOCK START — MD resolveHsmSubscribe: lazy require() prevents circular import; never convert to static module-level import [MD-2]
function resolveHsmSubscribe(): ((symbol: string) => void) | null {
  if (_cachedHsmSubscribe) return _cachedHsmSubscribe;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const hsm = require("./hsm-kotak-neo-v3") as { subscribe: (s: string) => void };
    if (typeof hsm.subscribe !== "function") {
      console.error(`${LOG_PREFIX} subscribe: hsm-kotak-neo-v3.subscribe is not a function — wiring failure`);
      return null;
    }
    _cachedHsmSubscribe = hsm.subscribe;
    return _cachedHsmSubscribe;
  } catch (err: any) {
    console.error(`${LOG_PREFIX} subscribe: failed to load hsm-kotak-neo-v3 — ${err?.message || err}`);
    return null;
  }
}
// 🔒 LOCKED BLOCK END

export function subscribe(symbol: string): void {
  const fn = resolveHsmSubscribe();
  if (!fn) {
    console.error(`${LOG_PREFIX} subscribe(${symbol}) dropped — HSM module unavailable`);
    return;
  }
  fn(symbol);
}

export function startMarketDataManager(): void {
  console.log(`${LOG_PREFIX} Market Data Manager ready`);
}
