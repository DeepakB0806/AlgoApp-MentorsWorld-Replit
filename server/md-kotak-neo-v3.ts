import EL from "./el-kotak-neo-v3";
import type { BrokerConfig } from "@shared/schema";

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

let _cachedHsmSubscribe: ((symbol: string) => void) | null = null;

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
