import type { IStorage } from "./storage";

const LOG_PREFIX = "[MARKET-CAL]";

function getISTDatetime(): { date: string; time: string } {
  const istDate = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  const yy = istDate.getFullYear();
  const mm = String(istDate.getMonth() + 1).padStart(2, "0");
  const dd = String(istDate.getDate()).padStart(2, "0");
  const hh = String(istDate.getHours()).padStart(2, "0");
  const min = String(istDate.getMinutes()).padStart(2, "0");
  return { date: `${yy}-${mm}-${dd}`, time: `${hh}:${min}` };
}

export function getISTDatetimeNow(): { date: string; time: string } {
  return getISTDatetime();
}

/**
 * Returns true if the given IST time and date fall within the trading window
 * for the given exchange, and it is not a market holiday.
 * Fail-open: if no settings row exists for the exchange, always returns true.
 */
export async function isWithinMarketHours(
  storage: IStorage,
  exchange: string,
  istTime: string,
  istDateStr: string,
): Promise<boolean> {
  try {
    const settings = await storage.getExchangeSetting(exchange);
    if (!settings || !settings.isActive) {
      return true;
    }
    if (istTime < settings.marketOpenTime || istTime > settings.marketCloseTime) {
      return false;
    }
    const isHoliday = !(await storage.isTradingDay(istDateStr, exchange));
    if (isHoliday) {
      console.log(`${LOG_PREFIX} ${exchange} market holiday on ${istDateStr} — skipping`);
      return false;
    }
    return true;
  } catch (err: any) {
    console.warn(`${LOG_PREFIX} isWithinMarketHours error for ${exchange} — failing open:`, err?.message || err);
    return true;
  }
}

/**
 * Seeds default exchange settings and index expiry settings.
 * Idempotent — skips rows that already exist.
 */
export async function seedMarketCalendarDefaults(storage: IStorage): Promise<void> {
  const EXCHANGE_DEFAULTS = [
    { exchange: "NSE", displayName: "NSE (Cash)", marketOpenTime: "09:15", marketCloseTime: "15:30" },
    { exchange: "BSE", displayName: "BSE (Cash)", marketOpenTime: "09:15", marketCloseTime: "15:30" },
    { exchange: "NFO", displayName: "NSE F&O",   marketOpenTime: "09:15", marketCloseTime: "15:30" },
    { exchange: "BFO", displayName: "BSE F&O",   marketOpenTime: "09:15", marketCloseTime: "15:30" },
    { exchange: "MCX", displayName: "MCX (Commodity)", marketOpenTime: "09:00", marketCloseTime: "23:30" },
    { exchange: "CDS", displayName: "NSE Currency",    marketOpenTime: "09:00", marketCloseTime: "17:00" },
  ];

  const INDEX_DEFAULTS = [
    { indexName: "NIFTY",      exchange: "NFO", defaultExpiryDay: 4 },
    { indexName: "BANKNIFTY",  exchange: "NFO", defaultExpiryDay: 3 },
    { indexName: "FINNIFTY",   exchange: "NFO", defaultExpiryDay: 2 },
    { indexName: "MIDCPNIFTY", exchange: "NFO", defaultExpiryDay: 1 },
    { indexName: "SENSEX",     exchange: "BFO", defaultExpiryDay: 5 },
    { indexName: "BANKEX",     exchange: "BFO", defaultExpiryDay: 1 },
  ];

  try {
    const existing = await storage.getExchangeSettings();
    const existingExchanges = new Set(existing.map((e) => e.exchange));
    for (const row of EXCHANGE_DEFAULTS) {
      if (!existingExchanges.has(row.exchange)) {
        await storage.upsertExchangeSetting(row.exchange, row);
      }
    }

    const existingExpiry = await storage.getIndexExpirySettings();
    const existingIndices = new Set(existingExpiry.map((e) => e.indexName));
    for (const row of INDEX_DEFAULTS) {
      if (!existingIndices.has(row.indexName)) {
        await storage.upsertIndexExpirySetting(row.indexName, row);
      }
    }

    console.log(`${LOG_PREFIX} Market calendar seed complete`);
  } catch (err: any) {
    console.warn(`${LOG_PREFIX} Seed warning:`, err?.message || err);
  }
}
