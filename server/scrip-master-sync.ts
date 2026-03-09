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
// Parses various date formats from CSV and infers expiry day of week
// ═══════════════════════════════════════════════════════════════════════════════
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function parseExpiryDate(raw: string): Date | null {
  if (!raw || raw === "-" || raw === "0") return null;
  const trimmed = raw.trim().replace(/"/g, '');

  const epochMs = Number(trimmed);
  if (!isNaN(epochMs) && epochMs > 946684800000) {
    return new Date(epochMs);
  }

  const epochSec = Number(trimmed);
  if (!isNaN(epochSec) && epochSec > 946684800 && epochSec < 4102444800) {
    return new Date(epochSec * 1000);
  }

  const d = new Date(trimmed);
  if (!isNaN(d.getTime())) return d;

  const ddmmmyyyy = trimmed.match(/^(\d{1,2})[-\/\s]?([A-Za-z]{3})[-\/\s]?(\d{2,4})$/);
  if (ddmmmyyyy) {
    const parsed = new Date(`${ddmmmyyyy[1]} ${ddmmmyyyy[2]} ${ddmmmyyyy[3]}`);
    if (!isNaN(parsed.getTime())) return parsed;
  }

  return null;
}

function inferExpiryDay(expiryDates: Date[]): string {
  if (expiryDates.length === 0) return "Thursday";

  const now = new Date();
  const sorted = expiryDates
    .filter(d => d >= now)
    .sort((a, b) => a.getTime() - b.getTime());

  if (sorted.length === 0) {
    const fallbackSorted = expiryDates.sort((a, b) => b.getTime() - a.getTime());
    const dayFreq = new Map<number, number>();
    for (const d of fallbackSorted.slice(0, 100)) {
      const day = d.getDay();
      dayFreq.set(day, (dayFreq.get(day) || 0) + 1);
    }
    let bestDay = 4;
    let bestCount = 0;
    for (const [day, count] of Array.from(dayFreq.entries())) {
      if (count > bestCount) { bestDay = day; bestCount = count; }
    }
    return DAY_NAMES[bestDay];
  }

  const nearestExpiry = sorted[0];
  return DAY_NAMES[nearestExpiry.getDay()];
}

// ═══════════════════════════════════════════════════════════════════════════════
// STRIKE INTERVAL INFERENCE
// Determines the most common gap between strike prices
// ═══════════════════════════════════════════════════════════════════════════════
function inferStrikeInterval(strikes: number[]): number {
  if (strikes.length < 2) return 50;
  const sorted = Array.from(new Set(strikes)).sort((a, b) => a - b);
  const freq = new Map<number, number>();
  for (let i = 1; i < sorted.length; i++) {
    const d = Math.round((sorted[i] - sorted[i - 1]) * 100) / 100;
    if (d > 0) freq.set(d, (freq.get(d) || 0) + 1);
  }
  if (freq.size === 0) return 50;
  const totalDiffs = sorted.length - 1;
  const minThreshold = totalDiffs * 0.15;
  let best = 50;
  let bestCount = 0;
  for (const [val, count] of Array.from(freq.entries())) {
    if (count >= minThreshold && (bestCount === 0 || val < best)) {
      best = val;
      bestCount = count;
    }
  }
  if (bestCount === 0) {
    for (const [val, count] of Array.from(freq.entries())) {
      if (count > bestCount) { bestCount = count; best = val; }
    }
  }
  return best;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CSV PARSING
// Parses scrip master CSV: headers, rows, column detection, ticker aggregation
// ═══════════════════════════════════════════════════════════════════════════════
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

function parseScripMasterCSV(csvText: string): ParsedInstrument[] {
  const lines = csvText.split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];

  const headerLine = lines[0];
  const headers = parseCSVLine(headerLine).map(h => h.toLowerCase().replace(/[^a-z0-9_]/g, ''));

  const symbolNameIdx = headers.findIndex(h => h === 'psymbolname' || h === 'symbolname' || h === 'symbol_name');
  const symbolIdx = symbolNameIdx >= 0 ? symbolNameIdx : headers.findIndex(h => h === 'psymbol' || h === 'symbol' || h === 'tsym' || h === 'tradingsymbol' || h === 'psymname');
  const preferredLotNames = ['lotsize', 'lot_size', 'plotsize', 'llotsize', 'ilotsize'];
  const fallbackLotNames = ['brdlotqty', 'boardlotqty', 'pbrdlotqty', 'iboardlotqty'];
  let lotIdx = headers.findIndex(h => preferredLotNames.includes(h));
  if (lotIdx < 0) lotIdx = headers.findIndex(h => fallbackLotNames.includes(h));
  const strikeIdx = headers.findIndex(h => h === 'strikeprice' || h === 'strike_price' || h === 'strkprc' || h === 'pstrikeprice' || h === 'pstrkprc' || h === 'dstrikeprice');
  const instTypeIdx = headers.findIndex(h => h === 'instrumenttype' || h === 'instrument_type' || h === 'insttype' || h === 'instype' || h === 'pinsttype' || h === 'pinstrumenttype');
  const tokenIdx = headers.findIndex(h => h === 'token' || h === 'pscriprefkey' || h === 'scripcode');
  const optTypeIdx = headers.findIndex(h => h === 'optiontype' || h === 'option_type' || h === 'optype' || h === 'opttype' || h === 'poptiontype' || h === 'popttype');
  const expiryIdx = headers.findIndex(h => h === 'pexpirydate' || h === 'dexpirydate' || h === 'expirydate' || h === 'expiry_date' || h === 'expdate' || h === 'pexpdate' || h === 'dexpdate');

  console.log(`${LOG_PREFIX} CSV headers (${headers.length}): ${headers.slice(0, 20).join(', ')}...`);
  console.log(`${LOG_PREFIX} Column indices: symbol=${symbolIdx}, lot=${lotIdx}(${lotIdx >= 0 ? headers[lotIdx] : 'none'}), strike=${strikeIdx}, instType=${instTypeIdx}, token=${tokenIdx}, optType=${optTypeIdx}, expiry=${expiryIdx}(${expiryIdx >= 0 ? headers[expiryIdx] : 'none'})`);
  if (expiryIdx < 0) {
    console.warn(`${LOG_PREFIX} ⚠ No expiry date column found in CSV — expiry day will fall back to Thursday. Available headers: ${headers.join(', ')}`);
  }

  const tickerData = new Map<string, { lotSizes: number[]; strikes: number[]; instrumentType: string; token: string | null; expiryDates: Date[] }>();

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    if (cols.length < 3) continue;

    const symbol = symbolIdx >= 0 ? cols[symbolIdx] : "";
    const lotSizeStr = lotIdx >= 0 ? cols[lotIdx] : "";
    const strikePriceStr = strikeIdx >= 0 ? cols[strikeIdx] : "";
    const instType = instTypeIdx >= 0 ? cols[instTypeIdx] : "";
    const token = tokenIdx >= 0 ? cols[tokenIdx] : null;

    if (!instType.includes("OPT") && !instType.includes("FUT")) continue;

    let baseTicker = "";
    for (const idx of INDEX_TICKERS) {
      if (symbol.startsWith(idx)) {
        baseTicker = idx;
        break;
      }
    }
    if (!baseTicker) continue;

    const lotSize = parseInt(lotSizeStr, 10);
    const rawStrike = parseFloat(strikePriceStr);
    const strikePrice = rawStrike / 100;

    const expiryRaw = expiryIdx >= 0 ? cols[expiryIdx] : "";
    const expiryDate = parseExpiryDate(expiryRaw);

    if (!tickerData.has(baseTicker)) {
      tickerData.set(baseTicker, { lotSizes: [], strikes: [], instrumentType: instType, token, expiryDates: [] });
    }

    const td = tickerData.get(baseTicker)!;
    if (!isNaN(lotSize) && lotSize > 0) td.lotSizes.push(lotSize);
    if (!isNaN(strikePrice) && strikePrice > 0) td.strikes.push(strikePrice);
    if (instType.includes("OPT")) td.instrumentType = instType;
    if (expiryDate) td.expiryDates.push(expiryDate);
  }

  const results: ParsedInstrument[] = [];
  for (const [ticker, data] of Array.from(tickerData.entries())) {
    const lotSizeFreq = new Map<number, number>();
    for (const ls of data.lotSizes) {
      lotSizeFreq.set(ls, (lotSizeFreq.get(ls) || 0) + 1);
    }

    const freqEntries = Array.from(lotSizeFreq.entries()).sort((a, b) => b[1] - a[1]);
    const freqLog = freqEntries.map(([val, cnt]) => `${val}(x${cnt})`).join(', ');
    console.log(`${LOG_PREFIX} ${ticker} lot sizes: ${freqLog || 'none'} | total rows: ${data.lotSizes.length}`);

    let lotSize = 1;
    if (freqEntries.length > 0) {
      lotSize = freqEntries[0][0];
    }

    const strikeInterval = inferStrikeInterval(data.strikes);
    const expiryDay = inferExpiryDay(data.expiryDates);
    console.log(`${LOG_PREFIX} ${ticker} expiry: ${data.expiryDates.length} dates parsed → nearest expiry day = ${expiryDay}`);

    results.push({
      ticker,
      exchange: "NFO",
      lotSize,
      strikeInterval,
      instrumentType: data.instrumentType,
      token: data.token,
      expiryDay,
    });
  }

  return results;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SCRIP MASTER DOWNLOAD & SYNC
// Downloads NFO CSV from Kotak, parses instruments, upserts to DB
// ═══════════════════════════════════════════════════════════════════════════════
async function downloadFile(url: string): Promise<string> {
  const response = await fetch(url, { signal: AbortSignal.timeout(180000) });
  if (!response.ok) throw new Error(`Download failed: ${response.status} ${response.statusText}`);
  return await response.text();
}

export async function runScripMasterSync(
  storage: IStorage,
  brokerConfig: BrokerConfig,
): Promise<{ success: boolean; synced: number; error?: string }> {
  const startTime = Date.now();
  console.log(`${LOG_PREFIX} Starting scrip master sync for broker ${brokerConfig.name}`);

  try {
    const filePathsResult = await EL.getScripMasterFilePaths(brokerConfig);
    if (!filePathsResult.success) {
      console.error(`${LOG_PREFIX} Failed to get file paths: ${filePathsResult.error}`);
      return { success: false, synced: 0, error: filePathsResult.error || "Failed to get file paths" };
    }

    const data = filePathsResult.data;
    console.log(`${LOG_PREFIX} File paths response:`, JSON.stringify(data).slice(0, 500));

    let nfoFileUrl: string | null = null;

    if (Array.isArray(data)) {
      for (const item of data) {
        const path = item.filePath || item.path || item.url || item.fileUrl || "";
        const name = item.fileName || item.name || item.exchange || "";
        if (path && (name.toLowerCase().includes("nfo") || name.toLowerCase().includes("nse_fo") || path.toLowerCase().includes("nfo") || path.toLowerCase().includes("nse_fo"))) {
          nfoFileUrl = path;
          break;
        }
      }
      if (!nfoFileUrl && data.length > 0) {
        for (const item of data) {
          const path = item.filePath || item.path || item.url || item.fileUrl || "";
          if (path) {
            nfoFileUrl = path;
            break;
          }
        }
      }
    } else if (data && typeof data === 'object') {
      const filesPaths = data.filesPaths || data.data?.filesPaths;
      if (filesPaths && Array.isArray(filesPaths)) {
        for (const item of filesPaths) {
          const path = typeof item === 'string' ? item : (item.filePath || item.path || item.url || "");
          const name = typeof item === 'string' ? item : (item.fileName || item.name || item.exchange || "");
          if (path && (name.toLowerCase().includes("nfo") || name.toLowerCase().includes("nse_fo") || path.toLowerCase().includes("nfo") || path.toLowerCase().includes("nse_fo"))) {
            nfoFileUrl = path;
            break;
          }
        }
      }
      if (!nfoFileUrl) {
        const urls = Object.values(data).filter(v => typeof v === 'string' && (v.includes('http') || v.includes('/')));
        for (const u of urls) {
          if (typeof u === 'string' && (u.toLowerCase().includes("nfo") || u.toLowerCase().includes("nse_fo"))) {
            nfoFileUrl = u;
            break;
          }
        }
      }
    }

    if (!nfoFileUrl) {
      const msg = "Could not find NFO scrip master file URL in response";
      console.error(`${LOG_PREFIX} ${msg}. Full response: ${JSON.stringify(data).slice(0, 1000)}`);
      return { success: false, synced: 0, error: msg };
    }

    console.log(`${LOG_PREFIX} Downloading NFO scrip master from: ${nfoFileUrl}`);
    const csvText = await downloadFile(nfoFileUrl);
    console.log(`${LOG_PREFIX} Downloaded ${csvText.length} bytes, ${csvText.split('\n').length} lines`);

    const parsed = parseScripMasterCSV(csvText);
    console.log(`${LOG_PREFIX} Parsed ${parsed.length} instruments: ${parsed.map(p => `${p.ticker}(lot=${p.lotSize},strike=${p.strikeInterval},expiry=${p.expiryDay})`).join(', ')}`);

    let synced = 0;
    for (const inst of parsed) {
      await storage.upsertInstrumentConfig({
        ticker: inst.ticker,
        exchange: inst.exchange,
        lotSize: inst.lotSize,
        strikeInterval: inst.strikeInterval,
        instrumentType: inst.instrumentType,
        token: inst.token,
        source: "scrip_master",
        expiryDay: inst.expiryDay,
        expiryType: "weekly",
      });
      synced++;
    }

    tradingCache.invalidateInstrumentConfigs();

    const elapsed = Date.now() - startTime;
    console.log(`${LOG_PREFIX} Sync complete: ${synced} instruments updated in ${elapsed}ms, cache invalidated`);
    return { success: true, synced };

  } catch (error: any) {
    const msg = error.message || "Unknown error";
    console.error(`${LOG_PREFIX} Sync failed: ${msg}`);
    return { success: false, synced: 0, error: msg };
  }
}
