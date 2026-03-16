// ═══════════════════════════════════════════════════════════════════════════════
// IMPORTS & CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════
import type { IStorage } from "./storage";
import type { BrokerConfig } from "@shared/schema";
import EL from "./el-kotak-neo-v3";
import { tradingCache } from "./cache";

const LOG_PREFIX = "[SCRIP-MASTER]";
const INDEX_TICKERS = ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "SENSEX", "BANKEX"];

// ═══════════════════════════════════════════════════════════════════════════════
// MULTI-EXPIRY LIVE CONTRACT CACHE
// Keyed by ticker_YYYY-MM-DD_strike_optType so the TE can look up contracts
// for any expiry date (current week, next week, monthly) — not just nearest.
// Populated on every scrip master sync from the broker's NFO CSV.
// ═══════════════════════════════════════════════════════════════════════════════
export const liveContractCache = new Map<string, { brokerSymbol: string, token: string }>();

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════
interface ParsedInstrument {
  ticker: string;
  exchange: string;
  lotSize: number;
  strikeInterval: number;
  instrumentType: string;
  token: string | null;
  expiryDay: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPIRY DATE PARSING
// ═══════════════════════════════════════════════════════════════════════════════
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function parseExpiryDate(raw: string): Date | null {
  if (!raw || raw === "-" || raw === "0") return null;
  const trimmed = raw.trim().replace(/"/g, '');

  const epochMs = Number(trimmed);
  if (!isNaN(epochMs) && epochMs > 946684800000) return new Date(epochMs);

  const epochSec = Number(trimmed);
  if (!isNaN(epochSec) && epochSec > 946684800 && epochSec < 4102444800) {
    // Kotak 1980 Epoch Offset (+ 315,532,800 seconds) IS REQUIRED!
    // This converts Kotak's 2016 timestamps into the correct 2026 dates.
    return new Date((epochSec + 315532800) * 1000);
  }

  const d = new Date(trimmed);
  if (!isNaN(d.getTime())) return d;

  const ddmmmyyyy = trimmed.match(/^(\d{1,2})[-\/\s]?([A-Za-z]{3})[-\/\s]?(\d{2,4})$/);
  if (ddmmmyyyy) return new Date(`${ddmmmyyyy[1]} ${ddmmmyyyy[2]} ${ddmmmyyyy[3]}`);

  return null;
}

function inferExpiryDay(expiryDates: Date[]): string {
  if (expiryDates.length === 0) return "Thursday";
  const now = new Date();
  const sorted = expiryDates.filter(d => d >= now).sort((a, b) => a.getTime() - b.getTime());
  if (sorted.length === 0) return "Thursday"; // Fallback
  return DAY_NAMES[sorted[0].getDay()];
}

// ═══════════════════════════════════════════════════════════════════════════════
// STRIKE INTERVAL INFERENCE (feeds instrument_configs.strike_interval)
// Uses the minimum non-zero gap between adjacent sorted unique strikes.
// Must receive ONLY nearest-expiry strikes to avoid far-expiry 100-point gaps
// inflating NIFTY's interval from the correct 50 to 100.
// ═══════════════════════════════════════════════════════════════════════════════
function inferStrikeInterval(strikes: number[]): number {
  if (strikes.length < 2) return 50;
  const sorted = Array.from(new Set(strikes)).sort((a, b) => a - b);
  let minGap = Infinity;
  for (let i = 1; i < sorted.length; i++) {
    const d = Math.round((sorted[i] - sorted[i - 1]) * 100) / 100;
    if (d > 0 && d < minGap) minGap = d;
  }
  return minGap === Infinity ? 50 : minGap;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CSV PARSING & CACHE POPULATION
// ═══════════════════════════════════════════════════════════════════════════════
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = ""; let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === ',' && !inQuotes) { result.push(current.trim()); current = ""; }
    else current += ch;
  }
  result.push(current.trim()); return result;
}

function parseScripMasterCSV(csvText: string): ParsedInstrument[] {
  const lines = csvText.split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];

  const headers = parseCSVLine(lines[0]).map(h => h.toLowerCase().replace(/[^a-z0-9_]/g, ''));

  const symbolIdx = headers.findIndex(h => h === 'psymbolname' || h === 'symbolname' || h === 'symbol' || h === 'tsym' || h === 'tradingsymbol');
  const lotIdx = headers.findIndex(h => ['lotsize', 'lot_size', 'plotsize', 'llotsize', 'ilotsize', 'brdlotqty'].includes(h));
  const strikeIdx = headers.findIndex(h => ['strikeprice', 'strike_price', 'strkprc', 'dstrikeprice'].includes(h));
  const instTypeIdx = headers.findIndex(h => ['instrumenttype', 'instrument_type', 'insttype', 'pinsttype'].includes(h));
  const tokenIdx = headers.findIndex(h => ['psymbol', 'token', 'scripcode'].includes(h));
  const optTypeIdx = headers.findIndex(h => ['optiontype', 'option_type', 'optype', 'poptiontype'].includes(h));
  const expiryIdx = headers.findIndex(h => ['lexpirydate', 'pexpirydate', 'dexpirydate', 'expirydate', 'expdate'].includes(h));
  const brokerSymbolIdx = headers.findIndex(h => h === 'ptrdsymbol' || h === 'ptrd_symbol' || h === 'tradingsymbol');

  const tickerData = new Map<string, { lotSizes: number[]; strikes: number[]; instrumentType: string; token: string | null; expiryDates: Date[] }>();
  const rawContracts: Array<{ ticker: string, strike: number, optType: string, date: Date, symbol: string, token: string }> = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    if (cols.length < 3) continue;

    const symbol = symbolIdx >= 0 ? cols[symbolIdx] : "";
    const instType = instTypeIdx >= 0 ? cols[instTypeIdx] : "";
    if (!instType.includes("OPT") && !instType.includes("FUT")) continue;

    let baseTicker = INDEX_TICKERS.find(idx => symbol.startsWith(idx)) || "";
    if (!baseTicker) continue;

    const strikePrice = parseFloat(strikeIdx >= 0 ? cols[strikeIdx] : "0") / 100;
    const expiryDate = parseExpiryDate(expiryIdx >= 0 ? cols[expiryIdx] : "");
    const brokerSymbol = brokerSymbolIdx >= 0 ? cols[brokerSymbolIdx] : "";
    const optionType = optTypeIdx >= 0 ? cols[optTypeIdx] : "";
    const token = tokenIdx >= 0 ? cols[tokenIdx] : "";

    // Store every single contract for the live memory cache
    if (instType.includes("OPT") && expiryDate && brokerSymbol) {
        rawContracts.push({ ticker: baseTicker, strike: strikePrice, optType: optionType, date: expiryDate, symbol: brokerSymbol, token });
    }

    if (!tickerData.has(baseTicker)) tickerData.set(baseTicker, { lotSizes: [], strikes: [], instrumentType: instType, token, expiryDates: [] });
    const td = tickerData.get(baseTicker)!;
    const lotSize = parseInt(lotIdx >= 0 ? cols[lotIdx] : "0", 10);
    if (!isNaN(lotSize) && lotSize > 0) td.lotSizes.push(lotSize);
    if (!isNaN(strikePrice) && strikePrice > 0) td.strikes.push(strikePrice);
    if (instType.includes("OPT")) td.instrumentType = instType;
    if (expiryDate) td.expiryDates.push(expiryDate);
  }

  // Populate the Multi-Expiry Live Contract Cache (ALL upcoming expiries)
  liveContractCache.clear();
  const startOfDay = new Date(); startOfDay.setHours(0,0,0,0);
  const nowTime = startOfDay.getTime();

  const nearestDates = new Map<string, number>();
  for (const c of rawContracts) {
      const t = c.date.getTime();
      if (t >= nowTime) {
          if (!nearestDates.has(c.ticker) || t < nearestDates.get(c.ticker)!) {
              nearestDates.set(c.ticker, t);
          }
      }
  }

  for (const c of rawContracts) {
      if (c.date.getTime() >= nowTime) {
          const y = c.date.getFullYear();
          const m = String(c.date.getMonth() + 1).padStart(2, "0");
          const d = String(c.date.getDate()).padStart(2, "0");
          const dateStr = `${y}-${m}-${d}`;
          const key = `${c.ticker}_${dateStr}_${c.strike}_${c.optType}`;
          liveContractCache.set(key, { brokerSymbol: c.symbol, token: c.token });
      }
  }
  console.log(`${LOG_PREFIX} Loaded ${liveContractCache.size} contracts (all upcoming expiries) into multi-expiry cache.`);

  // Collect nearest-expiry-only strikes per ticker for accurate strike interval inference
  const nearestStrikesByTicker = new Map<string, number[]>();
  for (const c of rawContracts) {
      if (c.date.getTime() === nearestDates.get(c.ticker)) {
          if (!nearestStrikesByTicker.has(c.ticker)) nearestStrikesByTicker.set(c.ticker, []);
          nearestStrikesByTicker.get(c.ticker)!.push(c.strike);
      }
  }

  const results: ParsedInstrument[] = [];
  for (const [ticker, data] of Array.from(tickerData.entries())) {
    const lotSizeFreq = new Map<number, number>();
    data.lotSizes.forEach(ls => lotSizeFreq.set(ls, (lotSizeFreq.get(ls) || 0) + 1));
    const lotSize = Array.from(lotSizeFreq.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || 1;
    const nearStrikes = nearestStrikesByTicker.get(ticker) || data.strikes;
    results.push({
      ticker, exchange: "NFO", lotSize, strikeInterval: inferStrikeInterval(nearStrikes),
      instrumentType: data.instrumentType, token: data.token, expiryDay: inferExpiryDay(data.expiryDates),
    });
  }
  return results;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SCRIP MASTER DOWNLOAD
// ═══════════════════════════════════════════════════════════════════════════════
export async function runScripMasterSync(storage: IStorage, brokerConfig: BrokerConfig): Promise<{ success: boolean; synced: number; error?: string }> {
  console.log(`${LOG_PREFIX} Starting scrip master sync for broker ${brokerConfig.name}`);
  try {
    const filePathsResult = await EL.getScripMasterFilePaths(brokerConfig);
    if (!filePathsResult.success) return { success: false, synced: 0, error: filePathsResult.error };

    let nfoFileUrl: string | null = null;
    const data: any = filePathsResult.data;

    // Deep search for the NFO CSV URL
    const searchUrl = (items: any[]) => {
      for (const item of items) {
        const path = typeof item === 'string' ? item : (item?.filePath || item?.path || item?.url || item?.fileUrl || "");
        if (path && (path.toLowerCase().includes("nfo") || path.toLowerCase().includes("nse_fo"))) return path;
      }
      return null;
    };

    if (Array.isArray(data)) nfoFileUrl = searchUrl(data);
    else if (data?.filesPaths && Array.isArray(data.filesPaths)) nfoFileUrl = searchUrl(data.filesPaths);
    else if (data?.data?.filesPaths && Array.isArray(data.data.filesPaths)) nfoFileUrl = searchUrl(data.data.filesPaths);

    if (!nfoFileUrl) return { success: false, synced: 0, error: "Could not find NFO scrip master file URL" };

    const csvText = await (await fetch(nfoFileUrl)).text();
    const parsed = parseScripMasterCSV(csvText);

    let synced = 0;
    for (const inst of parsed) {
      await storage.upsertInstrumentConfig({
        ticker: inst.ticker, exchange: inst.exchange, lotSize: inst.lotSize,
        strikeInterval: inst.strikeInterval, instrumentType: inst.instrumentType,
        token: inst.token, source: "scrip_master", expiryDay: inst.expiryDay, expiryType: "weekly",
      });
      synced++;
    }

    tradingCache.invalidateInstrumentConfigs();
    return { success: true, synced };
  } catch (error: any) {
    return { success: false, synced: 0, error: error.message };
  }
}