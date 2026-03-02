import type { IStorage } from "./storage";
import type { BrokerConfig } from "@shared/schema";
import EL from "./el-kotak-neo-v3";
import { tradingCache } from "./cache";

const LOG_PREFIX = "[SCRIP-MASTER]";

const INDEX_TICKERS = ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "SENSEX", "BANKEX"];

interface ParsedInstrument {
  ticker: string;
  exchange: string;
  lotSize: number;
  strikeInterval: number;
  instrumentType: string;
  token: string | null;
}

function inferStrikeInterval(strikes: number[]): number {
  if (strikes.length < 2) return 50;
  const sorted = Array.from(new Set(strikes)).sort((a, b) => a - b);
  const diffs: number[] = [];
  for (let i = 1; i < sorted.length && i < 20; i++) {
    diffs.push(sorted[i] - sorted[i - 1]);
  }
  if (diffs.length === 0) return 50;
  const freq = new Map<number, number>();
  for (const d of diffs) {
    freq.set(d, (freq.get(d) || 0) + 1);
  }
  let maxFreq = 0;
  let mode = 50;
  for (const [val, count] of Array.from(freq.entries())) {
    if (count > maxFreq && val > 0) {
      maxFreq = count;
      mode = val;
    }
  }
  return mode;
}

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

  const symbolIdx = headers.findIndex(h => h === 'psymbol' || h === 'symbol' || h === 'tsym' || h === 'tradingsymbol' || h === 'psymname');
  const lotIdx = headers.findIndex(h => h === 'lotsize' || h === 'lot_size' || h === 'brdlotqty' || h === 'boardlotqty');
  const strikeIdx = headers.findIndex(h => h === 'strikeprice' || h === 'strike_price' || h === 'strkprc');
  const instTypeIdx = headers.findIndex(h => h === 'instrumenttype' || h === 'instrument_type' || h === 'insttype' || h === 'instype');
  const tokenIdx = headers.findIndex(h => h === 'token' || h === 'pscriprefkey' || h === 'scripcode');
  const optTypeIdx = headers.findIndex(h => h === 'optiontype' || h === 'option_type' || h === 'optype' || h === 'opttype');

  console.log(`${LOG_PREFIX} CSV headers (${headers.length}): ${headers.slice(0, 15).join(', ')}...`);
  console.log(`${LOG_PREFIX} Column indices: symbol=${symbolIdx}, lot=${lotIdx}, strike=${strikeIdx}, instType=${instTypeIdx}, token=${tokenIdx}, optType=${optTypeIdx}`);

  const tickerData = new Map<string, { lotSizes: Set<number>; strikes: number[]; instrumentType: string; token: string | null }>();

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
    const strikePrice = parseFloat(strikePriceStr);

    if (!tickerData.has(baseTicker)) {
      tickerData.set(baseTicker, { lotSizes: new Set(), strikes: [], instrumentType: instType, token });
    }

    const td = tickerData.get(baseTicker)!;
    if (!isNaN(lotSize) && lotSize > 0) td.lotSizes.add(lotSize);
    if (!isNaN(strikePrice) && strikePrice > 0) td.strikes.push(strikePrice);
    if (instType.includes("OPT")) td.instrumentType = instType;
  }

  const results: ParsedInstrument[] = [];
  for (const [ticker, data] of Array.from(tickerData.entries())) {
    const lotSizes = Array.from(data.lotSizes);
    const lotSize = lotSizes.length > 0 ? Math.min(...lotSizes) : 1;
    const strikeInterval = inferStrikeInterval(data.strikes);

    results.push({
      ticker,
      exchange: "NFO",
      lotSize,
      strikeInterval,
      instrumentType: data.instrumentType,
      token: data.token,
    });
  }

  return results;
}

async function downloadFile(url: string): Promise<string> {
  const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
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
      if (data.filesPaths && Array.isArray(data.filesPaths)) {
        for (const item of data.filesPaths) {
          const path = item.filePath || item.path || item.url || "";
          const name = item.fileName || item.name || item.exchange || "";
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
    console.log(`${LOG_PREFIX} Parsed ${parsed.length} instruments: ${parsed.map(p => `${p.ticker}(lot=${p.lotSize},strike=${p.strikeInterval})`).join(', ')}`);

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
        expiryDay: "Thursday",
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
