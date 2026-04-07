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

let _subscribeHandler: (symbol: string) => void = () => {};

export function setSubscribeHandler(fn: (symbol: string) => void): void {
  _subscribeHandler = fn;
}

export function subscribe(symbol: string): void {
  _subscribeHandler(symbol);
}

export function startMarketDataManager(): void {
  console.log(`${LOG_PREFIX} Market Data Manager ready`);
}
