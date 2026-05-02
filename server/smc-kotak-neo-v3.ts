// ═══════════════════════════════════════════════════════════════════════════════
// IMPORTS & CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════
import fs from "fs";
import path from "path";
import type { IStorage } from "./storage";
import type { BrokerConfig, StrategyPlan, PlanTradeLeg, InstrumentConfig } from "@shared/schema";
import EL from "./el-kotak-neo-v3";
import { tradingCache } from "./cache";
import { isOptionExchange, getATMStrike } from "./option-symbol-builder";

// ⚠️ SPECIAL INSTRUCTION: NO AI OR DEVELOPER IS PERMITTED TO UNLOCK, MODIFY, OR TAMPER WITH ANY 🔒 LOCKED BLOCK WITHOUT EXPLICIT, PRIOR AUTHORIZATION FROM THE USER.
// ⚠️ CODING RULE: Any task that requires modifying a 🔒 LOCKED BLOCK MUST (a) explicitly name the locked block in the task description, and (b) obtain the user's written permission before the block is opened. No exceptions.
//
// 📋 SMC PERMANENT INVARIANTS — rules established through production incidents; never reverse without user sign-off:
//   [SMC-1] parseExpiryDate Kotak 1980 epoch offset: (epochSec + 315_532_800) * 1000. MUST NOT be removed — Kotak timestamps are seconds since 1980, not 1970.
//   [SMC-2] inferExpiryDay uses raw getDay() (no UTC correction) — intentional, proven correct for 2025/2026 NSE expiry resolution.
//   [SMC-3] inferStrikeInterval 15% frequency threshold — must receive nearest-expiry strikes only. Do not lower threshold or change frequency logic.
//   [SMC-4] populateContractCache key format: {ticker}_{YYYY-MM-DD}_{strike}_{optType} — TE holiday fallback scanner depends on this exact format.

const LOG_PREFIX = "[SCRIP-MASTER]";

// ═══════════════════════════════════════════════════════════════════════════════
// MULTI-EXPIRY LIVE CONTRACT CACHE
// Keyed by ticker_YYYY-MM-DD_strike_optType so the TE can look up contracts
// for any expiry date (current week, next week, monthly) — not just nearest.
// Populated on every scrip master sync from NFO + BFO CSVs.
// ═══════════════════════════════════════════════════════════════════════════════
export const liveContractCache = new Map<string, { brokerSymbol: string, token: string }>();
export const brokerSymbolToTokenMap = new Map<string, string>();

// ═══════════════════════════════════════════════════════════════════════════════
// RAW CSV CACHE
// Stores the raw CSV text for each exchange (e.g. "NFO", "BFO") after every
// sync. The scrip-master-download route serves from this cache instantly
// instead of re-fetching from Kotak on every button click.
// ═══════════════════════════════════════════════════════════════════════════════
export const rawCsvCache = new Map<string, string>(); // exchange → raw CSV text

// ═══════════════════════════════════════════════════════════════════════════════
// SYNC STATUS TRACKER
// Updated on every successful runScripMasterSync call so the API and UI can
// show exactly when the scrip master was last refreshed and flag stale data.
// ═══════════════════════════════════════════════════════════════════════════════
export const scripMasterSyncStatus = {
  lastSyncDateIST: "1970-01-01",
  lastSyncTimeIST: "00:00:00",
};

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

// 🔒 LOCKED BLOCK START — SMC parseExpiryDate: Kotak 1980 epoch offset (epochSec + 315_532_800) * 1000 is mandatory; removing gives wrong expiry years [SMC-1]
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
// 🔒 LOCKED BLOCK END

// 🔒 LOCKED BLOCK START — SMC inferExpiryDay: raw getDay() intentional, no UTC correction — proven correct for 2025/2026 NSE expiry days [SMC-2]
function inferExpiryDay(expiryDates: Date[]): string {
  if (expiryDates.length === 0) return "Thursday";
  const now = new Date();
  const sorted = expiryDates.filter(d => d >= now).sort((a, b) => a.getTime() - b.getTime());

  if (sorted.length === 0) {
    // No future expiry dates — fall back to frequency analysis of past dates
    const fallbackSorted = [...expiryDates].sort((a, b) => b.getTime() - a.getTime());
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

  // Reverted Replit's incorrect UTC offset. The raw getDay() accurately resolves
  // the exact 2025/2026 NSE Tuesday baseline and month-end prepone shifts.
  return DAY_NAMES[sorted[0].getDay()];
}
// 🔒 LOCKED BLOCK END

// ═══════════════════════════════════════════════════════════════════════════════
// STRIKE INTERVAL INFERENCE (feeds instrument_configs.strike_interval)
// Uses frequency analysis: picks the most common gap that appears in ≥15% of
// adjacent sorted unique strikes. Falls back to the most frequent gap overall.
// Must receive ONLY nearest-expiry strikes to avoid far-expiry 100-point gaps
// inflating NIFTY's interval from the correct 50 to 100.
// ═══════════════════════════════════════════════════════════════════════════════
// 🔒 LOCKED BLOCK START — SMC inferStrikeInterval: 15% frequency threshold with nearest-expiry-only input; do not lower threshold or change frequency logic [SMC-3]
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
// 🔒 LOCKED BLOCK END

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
// 🔒 LOCKED BLOCK START — SMC populateContractCache: cache key format {ticker}_{YYYY-MM-DD}_{strike}_{optType} — TE holiday fallback scanner depends on exact format [SMC-4]
function populateContractCache(allRawContracts: RawContract[]): void {
  liveContractCache.clear();
  brokerSymbolToTokenMap.clear();
  const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
  const nowTime = startOfDay.getTime();
  for (const c of allRawContracts) {
    if (c.date.getTime() >= nowTime) {
      const y = c.date.getFullYear();
      const m = String(c.date.getMonth() + 1).padStart(2, "0");
      const d = String(c.date.getDate()).padStart(2, "0");
      const key = `${c.ticker}_${y}-${m}-${d}_${c.strike}_${c.optType}`;
      liveContractCache.set(key, { brokerSymbol: c.symbol, token: c.token });
      if (c.symbol && c.token) brokerSymbolToTokenMap.set(c.symbol, c.token);
    }
  }
  console.log(`${LOG_PREFIX} Loaded ${liveContractCache.size} contracts (NFO + BFO, all upcoming expiries) into multi-expiry cache.`);
}
// 🔒 LOCKED BLOCK END

// ═══════════════════════════════════════════════════════════════════════════════
// SCRIP MASTER DOWNLOAD
// Fully config-driven: reads configured (ticker, exchange) pairs from
// strategy_configs, maps each exchange to a CSV URL via broker_exchange_maps,
// and parses only the tickers the user has actually configured. No hardcoded
// ticker lists — adding any ticker/exchange in the UI is sufficient.
// ═══════════════════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════════════════
// MARGIN ESTIMATION
// Runs after every scrip master sync. Calls EL.checkMargin for each leg of
// every active/deployed non-proxy plan linked to this broker. Stores sum of
// ordMrgn across all legs as estimatedMargin. Failures are non-fatal.
// ═══════════════════════════════════════════════════════════════════════════════
function parseTradeParamsLocal(plan: StrategyPlan): Record<string, any> | null {
  if (!plan.tradeParams) return null;
  try { return typeof plan.tradeParams === "string" ? JSON.parse(plan.tradeParams) : plan.tradeParams; }
  catch { return null; }
}

function selectLegsLocal(tradeParams: Record<string, any>, blockType: string): PlanTradeLeg[] {
  const legs = tradeParams[blockType];
  return Array.isArray(legs) ? legs : [];
}

function getBlockConfigLocal(tradeParams: Record<string, any>, blockType: string): Record<string, any> {
  const configKey = blockType.replace("Legs", "Config");
  return tradeParams[configKey] || {};
}

function findNearestExpiryDate(ticker: string): string | null {
  let earliest: string | null = null;
  for (const key of liveContractCache.keys()) {
    if (!key.startsWith(`${ticker}_`)) continue;
    const parts = key.split("_");
    if (parts.length < 4) continue;
    const date = parts[1];
    if (!earliest || date < earliest) earliest = date;
  }
  return earliest;
}

function extractOrdMrgn(data: unknown): number {
  if (!data || typeof data !== "object") return 0;
  const search = (obj: any, depth = 0): number => {
    if (depth > 5 || typeof obj !== "object" || obj === null) return 0;
    for (const k of ["ordMrgn", "ord_mrgn", "orderMargin", "ordMargin", "margin"]) {
      if (obj[k] !== undefined) { const v = Number(obj[k]); if (!isNaN(v)) return v; }
    }
    for (const v of Object.values(obj)) { const f = search(v, depth + 1); if (f !== 0) return f; }
    return 0;
  };
  return search(data);
}

export async function calculatePlanMargins(storage: IStorage, brokerConfig: BrokerConfig): Promise<void> {
  const LOG = "[MARGIN-CALC]";
  try {
    const allPlans = await storage.getStrategyPlans();
    const plansToCalc = allPlans
      .filter(p =>
        p.brokerConfigId === brokerConfig.id &&
        (p.deploymentStatus === "active" || p.deploymentStatus === "deployed") &&
        !p.isProxyMode
      )
      .sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999));

    if (plansToCalc.length === 0) {
      console.log(`${LOG} No active/deployed non-proxy plans for broker ${brokerConfig.name}`);
      return;
    }
    console.log(`${LOG} Calculating margins for ${plansToCalc.length} plan(s) — broker ${brokerConfig.name}`);

    for (const plan of plansToCalc) {
      try {
        const tradeParams = parseTradeParamsLocal(plan);
        if (!tradeParams) { console.warn(`${LOG} Plan "${plan.name}" — tradeParams missing, skipping`); continue; }

        const allLegs: PlanTradeLeg[] = ["legs", "uptrendLegs", "downtrendLegs", "neutralLegs"]
          .flatMap(bt => selectLegsLocal(tradeParams, bt));
        if (allLegs.length === 0) { console.warn(`${LOG} Plan "${plan.name}" — no legs, skipping`); continue; }

        const productMode = (
          getBlockConfigLocal(tradeParams, "uptrendLegs").productMode ||
          getBlockConfigLocal(tradeParams, "downtrendLegs").productMode ||
          getBlockConfigLocal(tradeParams, "neutralLegs").productMode ||
          getBlockConfigLocal(tradeParams, "legsConfig").productMode ||
          "MIS"
        ) as string;

        const ticker = plan.ticker;
        const exchange = plan.exchange;
        if (!ticker || !exchange || !isOptionExchange(exchange)) {
          console.warn(`${LOG} Plan "${plan.name}" — no ticker/exchange or non-option exchange, skipping`);
          continue;
        }

        let instrumentConfig: InstrumentConfig | undefined = tradingCache.getInstrumentConfig(ticker, exchange);
        if (!instrumentConfig) {
          instrumentConfig = await storage.getInstrumentConfig(ticker, exchange);
          if (instrumentConfig) tradingCache.setInstrumentConfig(ticker, exchange, instrumentConfig);
        }
        if (!instrumentConfig?.token || !instrumentConfig?.strikeInterval) {
          console.warn(`${LOG} Plan "${plan.name}" — instrumentConfig missing token/strikeInterval, skipping`);
          continue;
        }

        const quoteRes = await EL.getQuote(brokerConfig, EL.mapExchange(exchange), instrumentConfig.token);
        if (!quoteRes.success || !quoteRes.ltp) {
          console.warn(`${LOG} Plan "${plan.name}" — LTP fetch failed: ${quoteRes.error}`);
          continue;
        }
        const atmStrike = getATMStrike(quoteRes.ltp, instrumentConfig.strikeInterval ?? 50);
        const nearestDate = findNearestExpiryDate(ticker);
        if (!nearestDate) { console.warn(`${LOG} Plan "${plan.name}" — no cache entries for ticker ${ticker}`); continue; }

        const lotMultiplier = plan.lotMultiplier || 1;
        const lotSize = instrumentConfig.lotSize ?? 1;
        let totalMargin = 0;
        let anyFailed = false;

        for (const leg of allLegs) {
          const legType = (leg.type || "").toUpperCase();
          if (legType !== "CE" && legType !== "PE" && legType !== "FUT") continue;

          let token: string | undefined;
          if (legType === "FUT") {
            token = liveContractCache.get(`${ticker}_${nearestDate}_0_FUT`)?.token;
          } else {
            token = liveContractCache.get(`${ticker}_${nearestDate}_${atmStrike}_${legType}`)?.token;
          }
          if (!token) {
            console.warn(`${LOG} Plan "${plan.name}" leg ${legType} — token not in cache`);
            anyFailed = true;
            continue;
          }

          const marginRes = await EL.checkMargin(brokerConfig, {
            exSeg: EL.mapExchange(exchange),
            prc: "0", prcTp: "MKT", prod: productMode,
            qty: String((leg.lots || 1) * lotMultiplier * lotSize),
            tok: token,
            trnsTp: leg.action === "BUY" ? "B" : "S",
            brkName: "KOTAK", brnchId: "ONLINE",
          }, true);

          if (!marginRes.success) {
            console.warn(`${LOG} Plan "${plan.name}" leg ${legType} — checkMargin failed: ${(marginRes as any).error}`);
            anyFailed = true;
          } else {
            totalMargin += extractOrdMrgn(marginRes.data);
          }
          await new Promise(r => setTimeout(r, 100));
        }

        if (!anyFailed || totalMargin > 0) {
          await storage.updateStrategyPlan(plan.id, {
            estimatedMargin: String(totalMargin.toFixed(2)),
            marginCalculatedAt: new Date().toISOString(),
          });
          console.log(`${LOG} Plan "${plan.name}" — ₹${totalMargin.toFixed(2)}${anyFailed ? " (partial legs)" : ""}`);
        } else {
          console.warn(`${LOG} Plan "${plan.name}" — all leg margin calls failed; estimatedMargin unchanged`);
        }
      } catch (planErr: any) {
        console.error(`${LOG} Plan "${plan.name}" — unexpected error: ${planErr.message}`);
      }
    }
  } catch (err: any) {
    console.error(`${LOG} calculatePlanMargins outer error: ${err.message}`);
  }
}

// ─── Phase B: calculate margins for all connected broker UCCs, batched ────────
export async function runScripMasterSyncPhaseB(
  storage: IStorage,
  connectedBrokers: BrokerConfig[],
  batchSize = 10,
): Promise<void> {
  const LOG_B = "[SMC-PHASE-B]";
  if (connectedBrokers.length === 0) return;
  console.log(`${LOG_B} Calculating margins for ${connectedBrokers.length} UCC(s), batch=${batchSize}`);
  for (let i = 0; i < connectedBrokers.length; i += batchSize) {
    const batch = connectedBrokers.slice(i, i + batchSize);
    await Promise.all(batch.map(bc => calculatePlanMargins(storage, bc)));
    if (i + batchSize < connectedBrokers.length) {
      await new Promise(r => setTimeout(r, 200));
    }
  }
  console.log(`${LOG_B} Phase B complete`);
}

// ─── Startup disk loader: populate cache from today's on-disk CSVs ────────────
export async function loadScripMasterFromDisk(storage: IStorage): Promise<{ success: boolean; synced: number; error?: string }> {
  try {
    const today = new Date();
    const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

    // Collect tickers (same safety-net + strategy scan as Phase A)
    const allConfigs = await storage.getStrategyConfigs();
    const tickersByExchange = new Map<string, string[]>();
    tickersByExchange.set("NFO", ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY"]);
    tickersByExchange.set("BFO", ["SENSEX", "BANKEX"]);
    for (const cfg of allConfigs) {
      if (cfg.ticker && cfg.exchange && isOptionExchange(cfg.exchange)) {
        const ex = cfg.exchange.toUpperCase();
        if (!tickersByExchange.has(ex)) tickersByExchange.set(ex, []);
        if (!tickersByExchange.get(ex)!.includes(cfg.ticker)) tickersByExchange.get(ex)!.push(cfg.ticker);
      }
      const plans = await storage.getStrategyPlansByConfig(cfg.id);
      for (const plan of plans) {
        if (plan.ticker && plan.exchange && isOptionExchange(plan.exchange)) {
          const ex = plan.exchange.toUpperCase();
          if (!tickersByExchange.has(ex)) tickersByExchange.set(ex, []);
          if (!tickersByExchange.get(ex)!.includes(plan.ticker)) tickersByExchange.get(ex)!.push(plan.ticker);
        }
      }
    }

    const allRawContracts: RawContract[] = [];
    const allInstruments: ParsedInstrument[] = [];
    let loaded = 0;

    for (const [exchange, tickers] of tickersByExchange.entries()) {
      const filename = `scrip_master_${exchange.toLowerCase()}_${dateStr}.csv`;
      const filePath = path.resolve(process.cwd(), filename);
      if (!fs.existsSync(filePath)) {
        if (exchange === "NFO") console.warn(`${LOG_PREFIX} Disk load: NFO not found (${filename})`);
        continue;
      }
      try {
        const csvText = fs.readFileSync(filePath, "utf-8");
        const parsed = parseScripMasterCSV(csvText, exchange, tickers);
        allRawContracts.push(...parsed.rawContracts);
        allInstruments.push(...parsed.instruments);
        loaded++;
        console.log(`${LOG_PREFIX} Disk load ${exchange}: ${parsed.instruments.length} tickers, ${parsed.rawContracts.length} contracts`);
      } catch (err) {
        console.warn(`${LOG_PREFIX} Disk load failed for ${filename}: ${err}`);
      }
    }

    if (loaded === 0) {
      return { success: false, synced: 0, error: `No disk CSVs for ${dateStr}` };
    }

    populateContractCache(allRawContracts);
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

    const nowIST = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
    scripMasterSyncStatus.lastSyncDateIST = dateStr;
    scripMasterSyncStatus.lastSyncTimeIST = `${String(nowIST.getUTCHours()).padStart(2, "0")}:${String(nowIST.getUTCMinutes()).padStart(2, "0")}:${String(nowIST.getUTCSeconds()).padStart(2, "0")}`;

    console.log(`${LOG_PREFIX} Disk load complete — ${synced} instruments from ${loaded} exchange(s)`);
    return { success: true, synced };
  } catch (error: any) {
    return { success: false, synced: 0, error: error.message };
  }
}

export async function runScripMasterSync(storage: IStorage, brokerConfig: BrokerConfig): Promise<{ success: boolean; synced: number; error?: string }> {
  console.log(`${LOG_PREFIX} Starting scrip master sync for broker ${brokerConfig.name}`);
  try {
    // ── Step 1: Collect all unique (ticker, exchange) pairs from strategy configs & plans ──
    const allConfigs = await storage.getStrategyConfigs();
    const tickersByExchange = new Map<string, string[]>();

    // 🛡️ PERMANENT SAFETY NET: Always sync the major indices so the system never starves
    tickersByExchange.set("NFO", ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY"]);
    tickersByExchange.set("BFO", ["SENSEX", "BANKEX"]);

    for (const cfg of allConfigs) {
      // 1. Check Mother Config level
      if (cfg.ticker && cfg.exchange && isOptionExchange(cfg.exchange)) {
        const ex = cfg.exchange.toUpperCase();
        if (!tickersByExchange.has(ex)) tickersByExchange.set(ex, []);
        if (!tickersByExchange.get(ex)!.includes(cfg.ticker)) tickersByExchange.get(ex)!.push(cfg.ticker);
      }

      // 2. Check Plan level
      const plans = await storage.getStrategyPlansByConfig(cfg.id);
      for (const plan of plans) {
        if (plan.ticker && plan.exchange && isOptionExchange(plan.exchange)) {
          const ex = plan.exchange.toUpperCase();
          if (!tickersByExchange.has(ex)) tickersByExchange.set(ex, []);
          if (!tickersByExchange.get(ex)!.includes(plan.ticker)) tickersByExchange.get(ex)!.push(plan.ticker);
        }
      }
    }

    if (tickersByExchange.size === 0) {
      console.warn(`${LOG_PREFIX} No option exchange strategies configured — nothing to sync`);
      return { success: true, synced: 0 };
    }
    console.log(`${LOG_PREFIX} Configured exchanges to sync: ${[...tickersByExchange.entries()].map(([ex, tks]) => `${ex}=[${tks.join(",")}]`).join(", ")}`);

    // ── Step 2: Load exchange → broker_code map from DB ────────────────────────
    const exchangeMaps = await storage.getBrokerExchangeMaps(brokerConfig.brokerName || "kotak_neo_v3");
    const brokerCodeByExchange = new Map(exchangeMaps.map(m => [m.universalCode.toUpperCase(), m.brokerCode.toLowerCase()]));

    // ── Step 3: Fetch all available scrip master file paths (WITH TIMEOUT) ─────
    console.log(`${LOG_PREFIX} Requesting file paths from broker...`);

    const filePathsPromise = EL.getScripMasterFilePaths(brokerConfig);
    const timeoutPromise = new Promise<{success: boolean, error: string}>((resolve) => {
      setTimeout(() => resolve({ success: false, error: "Timed out waiting for Kotak scrip master file paths (30s)" }), 30000);
    });

    const filePathsResult = await Promise.race([filePathsPromise, timeoutPromise]) as any;

    if (!filePathsResult.success) {
      return { success: false, synced: 0, error: filePathsResult.error };
    }

    const data: any = filePathsResult.data;

    // Log raw Kotak response (truncated) for production diagnostics
    const rawResponseStr = JSON.stringify(data || {});
    console.log(`${LOG_PREFIX} Raw broker response: ${rawResponseStr.slice(0, 1000)}${rawResponseStr.length > 1000 ? "..." : ""}`);

    const flatItems: any[] = Array.isArray(data)
      ? data
      : Array.isArray(data?.filesPaths) ? data.filesPaths
      : Array.isArray(data?.data?.filesPaths) ? data.data.filesPaths
      : [];

    // Known Kotak scrip master filename keywords per exchange (from confirmed API response)
    const KOTAK_EXCHANGE_KEYWORDS: Record<string, string[]> = {
      NFO: ["nse_fo"],
      BFO: ["bse_fo"],
      CDS: ["cde_fo"],
      MCX: ["mcx_fo"],
    };

    const findUrl = (exchange: string, brokerCodeKeywords: string[]): string | null => {
      // Build a deduplicated keyword list: static known keywords first, then broker code / exchange name
      const staticKws = KOTAK_EXCHANGE_KEYWORDS[exchange.toUpperCase()] || [];
      const allKeywords = Array.from(new Set([...staticKws, ...brokerCodeKeywords]));
      let firstAvailablePath: string | null = null;

      for (const item of flatItems) {
        const path = typeof item === 'string' ? item : (item?.filePath || item?.path || item?.url || item?.fileUrl || "");
        if (path) {
          if (!firstAvailablePath) firstAvailablePath = path;
          if (allKeywords.some(kw => path.toLowerCase().includes(kw))) return path;
        }
      }

      console.warn(`${LOG_PREFIX} No keyword match found for ${exchange} (tried: [${allKeywords.join(", ")}]). Available paths: ${JSON.stringify(flatItems).slice(0, 300)}`);

      if (exchange === "NFO" && firstAvailablePath) {
        console.warn(`${LOG_PREFIX} [WARN] Using first available path as last resort for NFO: ${firstAvailablePath}`);
        return firstAvailablePath;
      }

      return null;
    };

    // ── Step 4: For each configured exchange, download & parse its CSV ─────────
    const allRawContracts: RawContract[] = [];
    const allInstruments: ParsedInstrument[] = [];
    let atLeastOneRequired = false;

    for (const [exchange, tickers] of tickersByExchange.entries()) {
      const brokerCode = brokerCodeByExchange.get(exchange);
      const brokerCodeKeywords = brokerCode ? [brokerCode, exchange.toLowerCase()] : [exchange.toLowerCase()];
      const csvUrl = findUrl(exchange, brokerCodeKeywords);

      if (!csvUrl) {
        if (exchange === "NFO") {
          return { success: false, synced: 0, error: `Could not find scrip master CSV for ${exchange} — required for configured strategies` };
        }
        console.warn(`${LOG_PREFIX} No scrip master CSV found for ${exchange} (tickers: ${tickers.join(",")}) — skipping`);
        continue;
      }

      try {
        console.log(`${LOG_PREFIX} Downloading CSV for ${exchange} from ${csvUrl}...`);

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 120000);

        const response = await fetch(csvUrl, { signal: controller.signal });
        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status} ${response.statusText}`);
        }

        const csvText = await response.text();
        rawCsvCache.set(exchange, csvText);
        const parsed = parseScripMasterCSV(csvText, exchange, tickers);
        console.log(`${LOG_PREFIX} ${exchange}: ${parsed.instruments.length} tickers, ${parsed.rawContracts.length} contracts`);
        allRawContracts.push(...parsed.rawContracts);
        allInstruments.push(...parsed.instruments);
        atLeastOneRequired = true;

        // Write to disk then free RAM — download route streams from disk
        try {
          const today = new Date();
          const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
          const filename = `scrip_master_${exchange.toLowerCase()}_${dateStr}.csv`;
          const filePath = path.resolve(process.cwd(), filename);
          fs.writeFileSync(filePath, csvText);
          rawCsvCache.delete(exchange);
          console.log(`${LOG_PREFIX} Saved ${exchange} CSV to disk (${filename}) and freed from RAM.`);
        } catch (fileErr) {
          console.error(`${LOG_PREFIX} Failed to write ${exchange} CSV to disk:`, fileErr);
        }
      } catch (fetchErr: any) {
        const errMsg = fetchErr.name === 'AbortError' ? 'Download timed out after 120s' : fetchErr.message;
        if (exchange === "NFO") return { success: false, synced: 0, error: `Failed to download ${exchange} CSV: ${errMsg}` };
        console.warn(`${LOG_PREFIX} ${exchange} CSV download failed (non-fatal): ${errMsg}`);
      }
    }

    if (!atLeastOneRequired) return { success: false, synced: 0, error: "No scrip master CSV could be loaded" };

    // ── Step 5: Populate cache and upsert instrument configs ───────────────────
    populateContractCache(allRawContracts);

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

    // Update sync status timestamp (IST)
    const nowIST = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
    scripMasterSyncStatus.lastSyncDateIST = `${nowIST.getUTCFullYear()}-${String(nowIST.getUTCMonth() + 1).padStart(2, "0")}-${String(nowIST.getUTCDate()).padStart(2, "0")}`;
    scripMasterSyncStatus.lastSyncTimeIST = `${String(nowIST.getUTCHours()).padStart(2, "0")}:${String(nowIST.getUTCMinutes()).padStart(2, "0")}:${String(nowIST.getUTCSeconds()).padStart(2, "0")}`;
    console.log(`${LOG_PREFIX} Scrip Master Sync Timestamp Updated to: ${scripMasterSyncStatus.lastSyncDateIST} ${scripMasterSyncStatus.lastSyncTimeIST} IST`);

    await calculatePlanMargins(storage, brokerConfig);
    return { success: true, synced };
  } catch (error: any) {
    return { success: false, synced: 0, error: error.message };
  }
}