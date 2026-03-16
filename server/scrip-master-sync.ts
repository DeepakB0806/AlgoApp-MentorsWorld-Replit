// ═══════════════════════════════════════════════════════════════════════════════
// IMPORTS & CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════
import type { IStorage } from "./storage";
import type { BrokerConfig } from "@shared/schema";
import EL from "./el-kotak-neo-v3";
import { tradingCache } from "./cache";

const LOG_PREFIX = "[SCRIP-MASTER]";
const NFO_TICKERS = ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY"];
const BFO_TICKERS = ["SENSEX", "BANKEX"];

// ═══════════════════════════════════════════════════════════════════════════════
// MULTI-EXPIRY LIVE CONTRACT CACHE
// Keyed by ticker_YYYY-MM-DD_strike_optType so the TE can look up contracts
// for any expiry date (current week, next week, monthly) — not just nearest.
// Populated on every scrip master sync from NFO + BFO CSVs.
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

type RawContract = { ticker: string; strike: number; optType: string; date: Date; symbol: string; token: string };

interface ParseResult {
  instruments: ParsedInstrument[];
  rawContracts: RawContract[];
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
  if (sorted.length === 0) return "Thursday";
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
// CSV PARSING
// Pure: returns instruments + raw contracts. Does NOT touch liveContractCache.
// exchange  — "NFO" or "BFO" (assigned to every ParsedInstrument returned).
// allowed   — only tickers in this list are processed from the CSV.
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

function parseScripMasterCSV(csvText: string, exchange: string, allowed: string[]): ParseResult {
  const lines = csvText.split('\n').filter(l => l.trim());
  if (lines.length < 2) return { instruments: [], rawContracts: [] };

  const headers = parseCSVLine(lines[0]).map(h => h.toLowerCase().replace(/[^a-z0-9_]/g, ''));

  const symbolIdx      = headers.findIndex(h => h === 'psymbolname' || h === 'symbolname' || h === 'symbol' || h === 'tsym' || h === 'tradingsymbol');
  const lotIdx         = headers.findIndex(h => ['lotsize', 'lot_size', 'plotsize', 'llotsize', 'ilotsize', 'brdlotqty'].includes(h));
  const strikeIdx      = headers.findIndex(h => ['strikeprice', 'strike_price', 'strkprc', 'dstrikeprice'].includes(h));
  const instTypeIdx    = headers.findIndex(h => ['instrumenttype', 'instrument_type', 'insttype', 'pinsttype'].includes(h));
  const tokenIdx       = headers.findIndex(h => ['psymbol', 'token', 'scripcode'].includes(h));
  const optTypeIdx     = headers.findIndex(h => ['optiontype', 'option_type', 'optype', 'poptiontype'].includes(h));
  const expiryIdx      = headers.findIndex(h => ['lexpirydate', 'pexpirydate', 'dexpirydate', 'expirydate', 'expdate'].includes(h));
  const brokerSymbolIdx = headers.findIndex(h => h === 'ptrdsymbol' || h === 'ptrd_symbol' || h === 'tradingsymbol');

  const tickerData = new Map<string, { lotSizes: number[]; strikes: number[]; instrumentType: string; token: string | null; expiryDates: Date[] }>();
  const rawContracts: RawContract[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    if (cols.length < 3) continue;

    const symbol   = symbolIdx >= 0 ? cols[symbolIdx] : "";
    const instType = instTypeIdx >= 0 ? cols[instTypeIdx] : "";
    if (!instType.includes("OPT") && !instType.includes("FUT")) continue;

    const baseTicker = allowed.find(t => symbol.startsWith(t)) || "";
    if (!baseTicker) continue;

    const strikePrice  = parseFloat(strikeIdx >= 0 ? cols[strikeIdx] : "0") / 100;
    const expiryDate   = parseExpiryDate(expiryIdx >= 0 ? cols[expiryIdx] : "");
    const brokerSymbol = brokerSymbolIdx >= 0 ? cols[brokerSymbolIdx] : "";
    const optionType   = optTypeIdx >= 0 ? cols[optTypeIdx] : "";
    const token        = tokenIdx >= 0 ? cols[tokenIdx] : "";

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

  // Nearest expiry per ticker — used for accurate strike interval inference
  const nearestDates = new Map<string, number>();
  for (const c of rawContracts) {
    const t = c.date.getTime();
    if (!nearestDates.has(c.ticker) || t < nearestDates.get(c.ticker)!) nearestDates.set(c.ticker, t);
  }
  const nearestStrikesByTicker = new Map<string, number[]>();
  for (const c of rawContracts) {
    if (c.date.getTime() === nearestDates.get(c.ticker)) {
      if (!nearestStrikesByTicker.has(c.ticker)) nearestStrikesByTicker.set(c.ticker, []);
      nearestStrikesByTicker.get(c.ticker)!.push(c.strike);
    }
  }

  const instruments: ParsedInstrument[] = [];
  for (const [ticker, data] of Array.from(tickerData.entries())) {
    const lotSizeFreq = new Map<number, number>();
    data.lotSizes.forEach(ls => lotSizeFreq.set(ls, (lotSizeFreq.get(ls) || 0) + 1));
    const lotSize    = Array.from(lotSizeFreq.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || 1;
    const nearStrikes = nearestStrikesByTicker.get(ticker) || data.strikes;
    instruments.push({
      ticker, exchange, lotSize, strikeInterval: inferStrikeInterval(nearStrikes),
      instrumentType: data.instrumentType, token: data.token, expiryDay: inferExpiryDay(data.expiryDates),
    });
  }

  return { instruments, rawContracts };
}

// ═══════════════════════════════════════════════════════════════════════════════
// CACHE POPULATION
// Clears and rebuilds liveContractCache from the merged set of raw contracts
// (NFO + BFO combined). Called once after all CSVs are parsed.
// ═══════════════════════════════════════════════════════════════════════════════
function populateContractCache(allRawContracts: RawContract[]): void {
  liveContractCache.clear();
  const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
  const nowTime = startOfDay.getTime();
  for (const c of allRawContracts) {
    if (c.date.getTime() >= nowTime) {
      const y = c.date.getFullYear();
      const m = String(c.date.getMonth() + 1).padStart(2, "0");
      const d = String(c.date.getDate()).padStart(2, "0");
      const key = `${c.ticker}_${y}-${m}-${d}_${c.strike}_${c.optType}`;
      liveContractCache.set(key, { brokerSymbol: c.symbol, token: c.token });
    }
  }
  console.log(`${LOG_PREFIX} Loaded ${liveContractCache.size} contracts (NFO + BFO, all upcoming expiries) into multi-expiry cache.`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SCRIP MASTER DOWNLOAD
// Downloads NFO CSV (required) and BFO CSV (optional, graceful on miss).
// Each exchange's tickers receive the correct exchange label in instrument_configs.
// ═══════════════════════════════════════════════════════════════════════════════
export async function runScripMasterSync(storage: IStorage, brokerConfig: BrokerConfig): Promise<{ success: boolean; synced: number; error?: string }> {
  console.log(`${LOG_PREFIX} Starting scrip master sync for broker ${brokerConfig.name}`);
  try {
    const filePathsResult = await EL.getScripMasterFilePaths(brokerConfig);
    if (!filePathsResult.success) return { success: false, synced: 0, error: filePathsResult.error };

    const data: any = filePathsResult.data;

    // ── URL search helper ──────────────────────────────────────────────────────
    const findUrl = (items: any[], keywords: string[]): string | null => {
      for (const item of items) {
        const path = typeof item === 'string' ? item : (item?.filePath || item?.path || item?.url || item?.fileUrl || "");
        if (path && keywords.some(kw => path.toLowerCase().includes(kw))) return path;
      }
      return null;
    };

    const flatItems: any[] = Array.isArray(data)
      ? data
      : Array.isArray(data?.filesPaths) ? data.filesPaths
      : Array.isArray(data?.data?.filesPaths) ? data.data.filesPaths
      : [];

    const nfoFileUrl = findUrl(flatItems, ["nfo", "nse_fo"]);
    const bfoFileUrl = findUrl(flatItems, ["bfo", "bse_fo", "bse"]);

    if (!nfoFileUrl) return { success: false, synced: 0, error: "Could not find NFO scrip master file URL" };
    if (!bfoFileUrl) console.warn(`${LOG_PREFIX} BFO scrip master file not found — SENSEX/BANKEX will not be synced`);

    // ── Parse NFO (required) ───────────────────────────────────────────────────
    const nfoCsv = await (await fetch(nfoFileUrl)).text();
    const nfoParsed = parseScripMasterCSV(nfoCsv, "NFO", NFO_TICKERS);
    console.log(`${LOG_PREFIX} NFO: ${nfoParsed.instruments.length} tickers, ${nfoParsed.rawContracts.length} contracts`);

    // ── Parse BFO (optional) ───────────────────────────────────────────────────
    let bfoParsed: ParseResult = { instruments: [], rawContracts: [] };
    if (bfoFileUrl) {
      try {
        const bfoCsv = await (await fetch(bfoFileUrl)).text();
        bfoParsed = parseScripMasterCSV(bfoCsv, "BFO", BFO_TICKERS);
        console.log(`${LOG_PREFIX} BFO: ${bfoParsed.instruments.length} tickers, ${bfoParsed.rawContracts.length} contracts`);
      } catch (bfoErr: any) {
        console.warn(`${LOG_PREFIX} BFO CSV download failed (non-fatal): ${bfoErr.message}`);
      }
    }

    // ── Populate cache from both exchanges in one pass ─────────────────────────
    populateContractCache([...nfoParsed.rawContracts, ...bfoParsed.rawContracts]);

    // ── Upsert instrument configs ──────────────────────────────────────────────
    const allInstruments = [...nfoParsed.instruments, ...bfoParsed.instruments];
    let synced = 0;
    for (const inst of allInstruments) {
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
