// ═══════════════════════════════════════════════════════════════════════════════
// CAPITAL MANAGER  (cm-kotak-neo-v3)
// Refreshes available capital per UCC from the broker API and persists
// snapshots to broker_capital_snapshots. TE reads these instead of calling
// getLimits live.
//
// calculatePlanMargins — Dual-Mode margin engine. Fully autonomous; no SMC import.
//   Mode 1 (API):  EL.getQuote → LTP → ATM; per-leg EL.checkMargin → sum ordMrgn.
//   Mode 2 (SPAN): CSV put-call parity ATM; csvPremium × spanRate per leg.
//   UT = uptrendLegs + neutralLegs combined; DT = downtrendLegs + neutralLegs.
//   estimatedMargin = max(UT, DT).
// ═══════════════════════════════════════════════════════════════════════════════
import fs from "fs";
import path from "path";
import type { IStorage } from "./storage";
import type { BrokerConfig } from "@shared/schema";
import EL from "./el-kotak-neo-v3";
import {
  getTargetExpiry,
  parseStrikeSpec,
  getOTMStrike,
  getATMStrike,
  isOptionExchange,
} from "./option-symbol-builder";
import { tradingCache } from "./cache";

const LOG = "[CAPITAL-MGR]";
const BATCH_SIZE = 10;
const BATCH_GAP_MS = 200;

// ─── extractAvailableCash ────────────────────────────────────────────────────
// Moved here from te-kotak-neo-v3.ts so TE can import from cm-kotak-neo-v3.
// Walks any nesting depth looking for the first positive cash-like field.
export function extractAvailableCash(data: unknown): number {
  if (!data || typeof data !== "object") return 0;
  const search = (obj: any, depth = 0): number => {
    if (depth > 5 || typeof obj !== "object" || obj === null) return 0;
    for (const k of [
      "cashmarginavailable", "cash_margin_available",
      "net", "Net", "NetAmount", "netAmount",
      "available_cash", "availableCash",
      "payin", "cashAvailable",
    ]) {
      if (obj[k] !== undefined) {
        const v = Number(obj[k]);
        if (!isNaN(v) && v > 0) return v;
      }
    }
    for (const v of Object.values(obj)) {
      const f = search(v, depth + 1);
      if (f > 0) return f;
    }
    return 0;
  };
  return search(data);
}

// ─── Core refresh ────────────────────────────────────────────────────────────
export async function refreshAllCapital(storage: IStorage): Promise<void> {
  try {
    const allConfigs = await storage.getBrokerConfigs();
    const allPlans = await storage.getStrategyPlans();

    // Only refresh UCCs that have at least one active or deployed plan
    const activeBrokerIds = new Set(
      allPlans
        .filter(p => p.deploymentStatus === "active" || p.deploymentStatus === "deployed")
        .map(p => p.brokerConfigId)
        .filter(Boolean) as string[],
    );

    const activeBrokers = allConfigs.filter(
      bc => bc.isConnected && bc.brokerName === "kotak_neo" && bc.ucc && activeBrokerIds.has(bc.id),
    );

    if (activeBrokers.length === 0) {
      console.log(`${LOG} No connected Kotak brokers with active/deployed plans — skipping`);
      return;
    }

    console.log(`${LOG} Refreshing capital for ${activeBrokers.length} UCC(s)`);

    for (let i = 0; i < activeBrokers.length; i += BATCH_SIZE) {
      const batch = activeBrokers.slice(i, i + BATCH_SIZE);

      await Promise.all(
        batch.map(async (bc) => {
          try {
            const limitsRes = await EL.getLimits(bc);
            const cash = limitsRes.success ? extractAvailableCash(limitsRes.data) : 0;
            await storage.upsertCapitalSnapshot({
              ucc: bc.ucc!,
              brokerName: bc.brokerName,
              brokerConfigId: bc.id,
              availableCapital: cash > 0 ? String(cash) : null,
              snapshotAt: Date.now(),
              rawResponse: limitsRes.success
                ? JSON.stringify(limitsRes.data).slice(0, 2000)
                : null,
            });
            console.log(`${LOG} UCC ${bc.ucc}: ₹${cash > 0 ? cash.toFixed(0) : "∞ (zero/failed)"}`);
          } catch (err) {
            console.warn(`${LOG} Failed for UCC ${bc.ucc}: ${err}`);
            try {
              await storage.upsertCapitalSnapshot({
                ucc: bc.ucc!,
                brokerName: bc.brokerName,
                brokerConfigId: bc.id,
                availableCapital: null,
                snapshotAt: Date.now(),
                rawResponse: null,
              });
            } catch {}
          }
        }),
      );

      if (i + BATCH_SIZE < activeBrokers.length) {
        await new Promise(r => setTimeout(r, BATCH_GAP_MS));
      }
    }

    console.log(`${LOG} Capital refresh complete`);
  } catch (err) {
    console.error(`${LOG} refreshAllCapital error: ${err}`);
  }
}

// ─── Single-UCC refresh (manual/intraday) ───────────────────────────────────
// 30s server-side debounce — returns existing snapshot if still fresh.
// Per-brokerConfigId in-flight coalescing — concurrent callers share one broker call.
const REFRESH_DEBOUNCE_MS = 30_000;
const inFlightRefresh = new Map<string, Promise<{ refreshed: boolean; snapshot: any | null; reason?: string }>>();

export async function refreshCapitalForBrokerConfig(
  storage: IStorage,
  brokerConfigId: string,
): Promise<{ refreshed: boolean; snapshot: any | null; reason?: string }> {
  const existingPromise = inFlightRefresh.get(brokerConfigId);
  if (existingPromise) return existingPromise;

  const promise = doRefreshCapitalForBrokerConfig(storage, brokerConfigId)
    .finally(() => { inFlightRefresh.delete(brokerConfigId); });
  inFlightRefresh.set(brokerConfigId, promise);
  return promise;
}

async function doRefreshCapitalForBrokerConfig(
  storage: IStorage,
  brokerConfigId: string,
): Promise<{ refreshed: boolean; snapshot: any | null; reason?: string }> {
  const bc = await storage.getBrokerConfig(brokerConfigId);
  if (!bc || !bc.ucc) {
    return { refreshed: false, snapshot: null, reason: "broker not found or missing UCC" };
  }
  if (bc.brokerName !== "kotak_neo") {
    return { refreshed: false, snapshot: null, reason: "only kotak_neo supported" };
  }
  if (!bc.isConnected) {
    const existing = await storage.getCapitalSnapshot(bc.ucc);
    return { refreshed: false, snapshot: existing ?? null, reason: "broker not connected" };
  }

  const existing = await storage.getCapitalSnapshot(bc.ucc);
  if (existing?.snapshotAt && Date.now() - Number(existing.snapshotAt) < REFRESH_DEBOUNCE_MS) {
    return { refreshed: false, snapshot: existing, reason: "debounced (snapshot < 30s old)" };
  }

  try {
    const limitsRes = await EL.getLimits(bc);
    const cash = limitsRes.success ? extractAvailableCash(limitsRes.data) : 0;
    const snap = await storage.upsertCapitalSnapshot({
      ucc: bc.ucc!,
      brokerName: bc.brokerName,
      brokerConfigId: bc.id,
      availableCapital: cash > 0 ? String(cash) : null,
      snapshotAt: Date.now(),
      rawResponse: limitsRes.success ? JSON.stringify(limitsRes.data).slice(0, 2000) : null,
    });
    console.log(`${LOG} Manual refresh UCC ${bc.ucc}: ₹${cash > 0 ? cash.toFixed(0) : "∞ (zero/failed)"}`);
    return { refreshed: true, snapshot: snap };
  } catch (err) {
    console.warn(`${LOG} Manual refresh failed for UCC ${bc.ucc}: ${err}`);
    try {
      const snap = await storage.upsertCapitalSnapshot({
        ucc: bc.ucc!,
        brokerName: bc.brokerName,
        brokerConfigId: bc.id,
        availableCapital: null,
        snapshotAt: Date.now(),
        rawResponse: null,
      });
      return { refreshed: true, snapshot: snap, reason: "broker call failed; snapshot cleared" };
    } catch {
      return { refreshed: false, snapshot: existing ?? null, reason: "broker call + persist both failed" };
    }
  }
}

// ─── Scheduler ───────────────────────────────────────────────────────────────
let capitalRefreshTimer: ReturnType<typeof setTimeout> | null = null;
let intradayRefreshTimer: ReturnType<typeof setInterval> | null = null;
let intradayLastRunMs = 0;

function scheduleNextCapitalRefresh(storage: IStorage): void {
  if (capitalRefreshTimer !== null) { clearTimeout(capitalRefreshTimer); capitalRefreshTimer = null; }

  // Fire at 09:00 IST (= 03:30 UTC)
  const nowUTC = Date.now();
  const target = new Date(nowUTC);
  target.setUTCHours(3, 30, 0, 0);
  if (target.getTime() <= nowUTC) target.setUTCDate(target.getUTCDate() + 1);

  const msUntil = target.getTime() - nowUTC;
  console.log(`${LOG} Next refresh at 09:00 IST (in ${Math.round(msUntil / 60000)} min)`);

  capitalRefreshTimer = setTimeout(async () => {
    await refreshAllCapital(storage);
    scheduleNextCapitalRefresh(storage);
  }, msUntil);
}

// Intraday refresh — fires every N minutes during market hours (09:15-15:30 IST).
// N is read from settings on every tick, so admin can change without restart.
function startIntradayCapitalRefresh(storage: IStorage): void {
  if (intradayRefreshTimer !== null) { clearInterval(intradayRefreshTimer); intradayRefreshTimer = null; }
  intradayRefreshTimer = setInterval(async () => {
    try {
      const setting = await storage.getSetting("cm_intraday_refresh_mins");
      const intervalMins = Math.max(1, parseInt(setting?.value || "5", 10) || 5);
      const intervalMs = intervalMins * 60 * 1000;

      // 09:15-15:30 IST = 03:45-10:00 UTC
      const now = new Date();
      const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
      if (utcMinutes < 225 /* 03:45 */ || utcMinutes > 600 /* 10:00 */) return;

      if (Date.now() - intradayLastRunMs < intervalMs) return;
      intradayLastRunMs = Date.now();

      console.log(`${LOG} Intraday refresh tick (every ${intervalMins} min)`);
      await refreshAllCapital(storage);
    } catch (err) {
      console.warn(`${LOG} Intraday tick error: ${err}`);
    }
  }, 60_000); // poll every minute, gate inside
}

export async function startCapitalManager(storage: IStorage): Promise<void> {
  try {
    await refreshAllCapital(storage);
  } catch (err) {
    console.warn(`${LOG} Startup refresh warning: ${err}`);
  }
  scheduleNextCapitalRefresh(storage);
  startIntradayCapitalRefresh(storage);
}

// ═══════════════════════════════════════════════════════════════════════════════
// CAPITAL MANAGER — calculatePlanMargins  (Dual-Mode: API primary, SPAN fallback)
// Autonomous — no SMC/TE imports. CSV is the sole data source.
// Mode 1 API: EL.getQuote LTP → ATM; per-leg EL.checkMargin; sum ordMrgn.
// Mode 2 SPAN: CSV put-call parity ATM; csvPremium × spanRate; SELL−, BUY+.
// UT = uptrendLegs+neutralLegs; DT = downtrendLegs+neutralLegs; max(UT,DT).
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Private helpers ──────────────────────────────────────────────────────────

function cmSelectLegs(tradeParams: Record<string, any>, blockType: string): any[] {
  const legs = tradeParams[blockType];
  return Array.isArray(legs) ? legs : [];
}

function cmIsExpiryDay(targetExpiryDate: string): boolean {
  const todayIST = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
  return todayIST === targetExpiryDate;
}

// Local tradeParams parser — no TE import needed.
function cmParseTradeParams(plan: { tradeParams?: any }): Record<string, any> | null {
  if (!plan.tradeParams) return null;
  try {
    return typeof plan.tradeParams === "string"
      ? JSON.parse(plan.tradeParams)
      : plan.tradeParams;
  } catch {
    return null;
  }
}

// Kotak 1980 epoch → YYYY-MM-DD. Mirrors SMC [SMC-1] without importing it.
function cmParseExpiryEpoch(raw: string): string | null {
  const sec = Number(raw.trim().replace(/"/g, ""));
  if (isNaN(sec) || sec <= 946684800 || sec >= 4102444800) return null;
  const d = new Date((sec + 315_532_800) * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Returns the numeric margin when the field is found (including 0), or null when absent.
function cmExtractOrdMrgn(data: unknown): number | null {
  if (!data || typeof data !== "object") return null;
  const search = (obj: Record<string, unknown>, depth = 0): number | null => {
    if (depth > 5) return null;
    for (const k of ["ordMrgn", "ord_mrgn", "orderMargin", "ordMargin"]) {
      if (obj[k] !== undefined) { const v = Number(obj[k]); if (!isNaN(v)) return v; }
    }
    for (const v of Object.values(obj)) {
      if (v && typeof v === "object") { const f = search(v as Record<string, unknown>, depth + 1); if (f !== null) return f; }
    }
    return null;
  };
  return search(data as Record<string, unknown>);
}

// Single CSV pass (cols 1,5,7,18,21,58) → tokenMap + priceMap + ATM via put-call parity.
function cmBuildTokenAndPriceMap(
  ticker: string,
  exchange: string,
  targetExpiryDate: string,
  strikeInterval: number,
): { atmStrike: number; tokenMap: Map<string, string>; priceMap: Map<number, { CE?: number; PE?: number }> } | null {
  const MLOG = "[MARGIN-CALC]";

  const todayIST = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
  const csvFilename = `scrip_master_${exchange.toLowerCase()}_${todayIST}.csv`;
  const csvFilePath = path.resolve(process.cwd(), csvFilename);
  if (!fs.existsSync(csvFilePath)) {
    console.warn(`${MLOG} cmBuildTokenAndPriceMap: CSV not found (${csvFilename}) — run scrip sync first`);
    return null;
  }

  const rawCsv = fs.readFileSync(csvFilePath, "utf-8");
  const tokenMap = new Map<string, string>();
  const priceMap = new Map<number, { CE?: number; PE?: number }>();

  for (const line of rawCsv.split("\n")) {
    if (!line.trim()) continue;
    const cols = line.split(",");
    if (cols.length < 58) continue;

    const rowTicker = cols[4]?.trim().replace(/"/g, "");
    if (rowTicker !== ticker) continue;

    const optType = cols[6]?.trim().replace(/"/g, "");
    if (optType !== "CE" && optType !== "PE") continue;

    const expiryDate = cmParseExpiryEpoch(cols[17] ?? "");
    if (expiryDate !== targetExpiryDate) continue;

    const token = cols[0]?.trim().replace(/"/g, "");
    if (!token) continue;

    const strike = Math.round(Number(cols[20]?.trim().replace(/"/g, "")) / 100);
    if (!strike || strike <= 0) continue;

    tokenMap.set(`${strike}_${optType}`, token);

    const price = Number(cols[57]?.trim().replace(/"/g, "")) / 100;
    if (!isNaN(price) && price > 0) {
      const existing = priceMap.get(strike) ?? {};
      if (optType === "CE") existing.CE = price;
      else existing.PE = price;
      priceMap.set(strike, existing);
    }
  }

  if (priceMap.size === 0) {
    console.warn(`${MLOG} cmBuildTokenAndPriceMap: no entries for ${ticker} ${targetExpiryDate} in ${csvFilename}`);
    return null;
  }

  let bestStrike: number | null = null;
  let bestDiff = Infinity;
  for (const [strike, prices] of priceMap) {
    if (prices.CE === undefined || prices.PE === undefined) continue;
    const diff = Math.abs(prices.CE - prices.PE);
    if (diff < bestDiff) { bestDiff = diff; bestStrike = strike; }
  }
  if (bestStrike === null) {
    console.warn(`${MLOG} cmBuildTokenAndPriceMap: no paired CE+PE found for ${ticker} ${targetExpiryDate}`);
    return null;
  }

  const atmStrike = getATMStrike(bestStrike, strikeInterval);
  const pair = priceMap.get(bestStrike)!;
  console.log(
    `${MLOG} ATM=${atmStrike} (parity |CE-PE|=${bestDiff.toFixed(2)}, CE=${pair.CE?.toFixed(2)}, PE=${pair.PE?.toFixed(2)}) — ${priceMap.size} strikes for ${targetExpiryDate}`,
  );
  return { atmStrike, tokenMap, priceMap };
}

// ─── Mode 1: API block ────────────────────────────────────────────────────────
async function cmApiBlock(
  legs: any[],
  atmStrike: number,
  strikeInterval: number,
  tokenMap: Map<string, string>,
  lotSize: number,
  lotMultiplier: number,
  brokerConfig: BrokerConfig,
  exchange: string,
  productMode: string,
  blockLabel: string,
): Promise<{ total: number; anyFailed: boolean }> {
  const MLOG = "[MARGIN-CALC]";
  let total = 0;
  let anyFailed = false;

  for (const leg of legs) {
    const legType = (leg.type || "").toUpperCase() as "CE" | "PE" | "FUT";
    if (legType !== "CE" && legType !== "PE" && legType !== "FUT") continue;

    const legAction = (leg.action || "SELL").toUpperCase();
    const qty = (leg.lots || 1) * lotMultiplier * lotSize;

    let token: string | undefined;
    if (legType === "FUT") {
      token = tokenMap.get(`0_FUT`);
    } else {
      const spec = parseStrikeSpec(leg.strike || "ATM");
      const resolvedStrike = getOTMStrike(atmStrike, spec, strikeInterval, legType as "CE" | "PE");
      token = tokenMap.get(`${resolvedStrike}_${legType}`);
      if (!token) {
        console.warn(`${MLOG}   ${blockLabel} API: no token for ${legType} strike=${resolvedStrike}`);
        anyFailed = true;
        continue;
      }
    }
    if (!token) { anyFailed = true; continue; }

    const marginRes = await EL.checkMargin(brokerConfig, {
      exSeg: EL.mapExchange(exchange),
      prc: "0", prcTp: "MKT", prod: productMode,
      qty: String(qty), tok: token,
      trnsTp: legAction === "BUY" ? "B" : "S",
      brkName: "KOTAK", brnchId: "ONLINE",
    }, true);

    if (!marginRes.success) {
      console.warn(`${MLOG}   ${blockLabel} API: checkMargin failed (${(marginRes as { error?: string }).error ?? "unknown"})`);
      anyFailed = true;
    } else {
      const mrgn = cmExtractOrdMrgn(marginRes.data);
      if (mrgn === null) {
        console.warn(`${MLOG}   ${blockLabel} API: ordMrgn field absent in response — treating as failure`);
        anyFailed = true;
      } else {
        total += mrgn;
        console.log(`${MLOG}   ${blockLabel} API: ${legAction} ${legType} ordMrgn=₹${mrgn.toFixed(2)}`);
      }
    }
    await new Promise(r => setTimeout(r, 100));
  }
  return { total, anyFailed };
}

// ─── Mode 2: SPAN fallback block ─────────────────────────────────────────────
// csvPremium × spanRate × lotSize × lotMult × lots; SELL−, BUY+; |total|
function cmSpanBlock(
  legs: any[],
  atmStrike: number,
  strikeInterval: number,
  priceMap: Map<number, { CE?: number; PE?: number }>,
  effectiveSpanRate: number,
  lotSize: number,
  lotMultiplier: number,
  blockLabel: string,
): number {
  const MLOG = "[MARGIN-CALC]";
  let total = 0;

  for (const leg of legs) {
    const legType = (leg.type || "").toUpperCase() as "CE" | "PE" | "FUT";
    if (legType !== "CE" && legType !== "PE" && legType !== "FUT") continue;

    const legAction = (leg.action || "SELL").toUpperCase();
    const lots = leg.lots || 1;

    let resolvedStrike: number;
    if (legType === "FUT") {
      resolvedStrike = atmStrike;
    } else {
      const spec = parseStrikeSpec(leg.strike || "ATM");
      resolvedStrike = getOTMStrike(atmStrike, spec, strikeInterval, legType as "CE" | "PE");
    }

    const priceEntry = priceMap.get(resolvedStrike);
    const csvPremium = legType === "FUT"
      ? resolvedStrike
      : ((legType === "CE" ? priceEntry?.CE : priceEntry?.PE) ?? 0);

    if (csvPremium <= 0) {
      console.warn(`${MLOG}   ${blockLabel} SPAN: no price for ${legType} strike=${resolvedStrike} — ₹0`);
    }

    const contribution = csvPremium * effectiveSpanRate * lotSize * lotMultiplier * lots;
    if (legAction === "SELL") {
      total -= contribution;
      console.log(`${MLOG}   ${blockLabel} SPAN: SELL ${legType} @${resolvedStrike} prem=₹${csvPremium} −₹${contribution.toFixed(2)}`);
    } else {
      total += contribution;
      console.log(`${MLOG}   ${blockLabel} SPAN: BUY  ${legType} @${resolvedStrike} prem=₹${csvPremium} +₹${contribution.toFixed(2)}`);
    }
  }
  return Math.abs(total);
}

// ─── calculatePlanMargins ────────────────────────────────────────────────────
export async function calculatePlanMargins(
  storage: IStorage,
  brokerConfig: BrokerConfig,
): Promise<void> {
  const MLOG = "[MARGIN-CALC]";
  try {
    const spanRateSetting   = await storage.getSetting("span_rate_percent");
    const expiryMultSetting = await storage.getSetting("expiry_day_span_multiplier");
    const parsedSpanRate    = parseFloat(spanRateSetting?.value || "");
    const parsedExpiryMult  = parseFloat(expiryMultSetting?.value || "");
    const baseSpanRate      = (isNaN(parsedSpanRate)   || parsedSpanRate   <= 0) ? 0.05 : parsedSpanRate / 100;
    const expiryMultiplier  = (isNaN(parsedExpiryMult) || parsedExpiryMult < 1)  ? 1.5  : parsedExpiryMult;

    const allPlans = await storage.getStrategyPlans();
    const plansToCalc = allPlans
      .filter(p =>
        p.brokerConfigId === brokerConfig.id &&
        (p.deploymentStatus === "active" || p.deploymentStatus === "deployed"),
      )
      .sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999));

    if (plansToCalc.length === 0) {
      console.log(`${MLOG} No active/deployed plans for broker ${brokerConfig.name}`);
      return;
    }
    console.log(`${MLOG} Calculating margins for ${plansToCalc.length} plan(s) — broker ${brokerConfig.name} (SPAN rate: ${(baseSpanRate * 100).toFixed(1)}%)`);

    for (const plan of plansToCalc) {
      try {
        // 1. Parse tradeParams (local, no TE import)
        const tradeParams = cmParseTradeParams(plan);
        if (!tradeParams) { console.warn(`${MLOG} Plan "${plan.name}" — tradeParams missing, skipping`); continue; }

        const ticker   = plan.ticker;
        const exchange = plan.exchange;
        if (!ticker || !exchange || !isOptionExchange(exchange)) {
          console.warn(`${MLOG} Plan "${plan.name}" — no ticker/exchange or non-option exchange, skipping`);
          continue;
        }

        // 2. instrumentConfig
        const instrumentConfig = await storage.getInstrumentConfig(ticker, exchange);
        if (!instrumentConfig) {
          console.warn(`${MLOG} Plan "${plan.name}" — no instrumentConfig for ${ticker}/${exchange}, skipping`);
          continue;
        }
        const strikeInterval = instrumentConfig.strikeInterval ?? 50;
        const lotSize        = instrumentConfig.lotSize ?? 1;
        const lotMultiplier  = plan.lotMultiplier || 1;
        const expiryDay      = instrumentConfig.expiryDay;
        if (!expiryDay) { console.warn(`${MLOG} Plan "${plan.name}" — expiryDay missing, skipping`); continue; }

        // 3. Resolve target expiry (respects expiryWeekOffset)
        const timeLogic        = tradeParams.timeLogic as { expiryType?: string; expiryWeekOffset?: number } | undefined;
        const expiryType       = timeLogic?.expiryType || "weekly";
        const weekOffset       = timeLogic?.expiryWeekOffset || 0;
        const targetDate       = getTargetExpiry(expiryDay, expiryType, weekOffset);
        const targetExpiryDate = `${targetDate.getFullYear()}-${String(targetDate.getMonth() + 1).padStart(2, "0")}-${String(targetDate.getDate()).padStart(2, "0")}`;
        console.log(`${MLOG} Plan "${plan.name}" — expiry: ${expiryDay} ${expiryType} offset=${weekOffset} → ${targetExpiryDate}`);

        // 4. Expiry-day SPAN multiplier
        const isExpiry          = cmIsExpiryDay(targetExpiryDate);
        const effectiveSpanRate = baseSpanRate * (isExpiry ? expiryMultiplier : 1);
        if (isExpiry) console.log(`${MLOG} Plan "${plan.name}" — EXPIRY DAY: spanRate ×${expiryMultiplier} → ${(effectiveSpanRate * 100).toFixed(2)}%`);

        // 5. Build token map + price map from CSV (fully autonomous)
        const csvResult = cmBuildTokenAndPriceMap(ticker, exchange, targetExpiryDate, strikeInterval);
        if (!csvResult) {
          console.warn(`${MLOG} Plan "${plan.name}" — CSV data unavailable for ${targetExpiryDate}; skipping`);
          continue;
        }
        const { atmStrike, tokenMap, priceMap } = csvResult;
        console.log(`${MLOG} Plan "${plan.name}" — ATM=${atmStrike} (CSV parity, ${ticker} ${targetExpiryDate})`);

        // 6. Combine legs: UT = uptrendLegs+neutralLegs, DT = downtrendLegs+neutralLegs
        const utLegs = [...cmSelectLegs(tradeParams, "uptrendLegs"),   ...cmSelectLegs(tradeParams, "neutralLegs")];
        const dtLegs = [...cmSelectLegs(tradeParams, "downtrendLegs"), ...cmSelectLegs(tradeParams, "neutralLegs")];

        // 7. productMode per block — resolved from each block's config, falling back to legsConfig then "MIS".
        type BlockCfg = { productMode?: string };
        const sharedFallback = (tradeParams.legsConfig as BlockCfg | undefined)?.productMode ?? "MIS";
        const utProductMode = (tradeParams.uptrendConfig  as BlockCfg | undefined)?.productMode
          ?? (tradeParams.neutralConfig as BlockCfg | undefined)?.productMode
          ?? sharedFallback;
        const dtProductMode = (tradeParams.downtrendConfig as BlockCfg | undefined)?.productMode
          ?? (tradeParams.neutralConfig as BlockCfg | undefined)?.productMode
          ?? sharedFallback;

        // 8. Try Mode 1: API (only when broker session is live)
        let utMargin = 0;
        let dtMargin = 0;
        let usedMode = "SPAN";

        if (brokerConfig.isConnected && brokerConfig.accessToken) {
          // Attempt live ATM refinement using EL.getQuote with instrumentConfig.token.
          // instrumentConfig.token is set during scrip master sync from the first OPT/FUT
          // row for the ticker; it may be a futures or option token. We validate the LTP:
          // index/futures prices are in thousands, option premiums are < strikeInterval×200.
          // Only accept if ltp > strikeInterval × 200 (e.g. >10000 for NIFTY/50).
          let apiAtmStrike = atmStrike;
          try {
            const quoteRes = await EL.getQuote(brokerConfig, EL.mapExchange(exchange), instrumentConfig.token ?? "");
            if (quoteRes.success && quoteRes.ltp && quoteRes.ltp > strikeInterval * 200) {
              apiAtmStrike = getATMStrike(quoteRes.ltp, strikeInterval);
              console.log(`${MLOG} Plan "${plan.name}" — LTP=${quoteRes.ltp} → live ATM=${apiAtmStrike}`);
            } else if (quoteRes.success && quoteRes.ltp) {
              console.log(`${MLOG} Plan "${plan.name}" — LTP=${quoteRes.ltp} below index threshold; using CSV parity ATM=${atmStrike}`);
            }
          } catch { /* non-fatal — keep CSV parity ATM */ }

          console.log(`${MLOG} Plan "${plan.name}" — trying API mode (ATM=${apiAtmStrike})`);
          const [utRes, dtRes] = await Promise.all([
            cmApiBlock(utLegs, apiAtmStrike, strikeInterval, tokenMap, lotSize, lotMultiplier, brokerConfig, exchange, utProductMode, "UT"),
            cmApiBlock(dtLegs, apiAtmStrike, strikeInterval, tokenMap, lotSize, lotMultiplier, brokerConfig, exchange, dtProductMode, "DT"),
          ]);

          if (!utRes.anyFailed && !dtRes.anyFailed && (utRes.total > 0 || dtRes.total > 0)) {
            utMargin = utRes.total;
            dtMargin = dtRes.total;
            usedMode = "API";
            console.log(`${MLOG} Plan "${plan.name}" — API: UT=₹${utMargin.toFixed(2)} DT=₹${dtMargin.toFixed(2)}`);
          } else {
            console.log(`${MLOG} Plan "${plan.name}" — API partial/failed; using SPAN fallback`);
          }
        }

        // 9. Mode 2: SPAN fallback
        if (usedMode === "SPAN") {
          utMargin = cmSpanBlock(utLegs, atmStrike, strikeInterval, priceMap, effectiveSpanRate, lotSize, lotMultiplier, "UT");
          dtMargin = cmSpanBlock(dtLegs, atmStrike, strikeInterval, priceMap, effectiveSpanRate, lotSize, lotMultiplier, "DT");
          console.log(`${MLOG} Plan "${plan.name}" — SPAN: UT=₹${utMargin.toFixed(2)} DT=₹${dtMargin.toFixed(2)}`);
        }

        const totalMargin = Math.max(utMargin, dtMargin);
        console.log(`${MLOG} Plan "${plan.name}" [${usedMode}] → estimatedMargin=₹${totalMargin.toFixed(2)}`);

        // 10. Persist
        await storage.updateStrategyPlan(plan.id, {
          estimatedMargin: String(totalMargin.toFixed(2)),
          marginCalculatedAt: new Date().toISOString(),
        });

      } catch (planErr: any) {
        console.error(`${MLOG} Plan "${plan.name}" — unexpected error: ${planErr.message}`);
      }
    }

    tradingCache.invalidatePlans(brokerConfig.id);
    console.log(`${MLOG} Cache invalidated for broker ${brokerConfig.name}`);
  } catch (err: any) {
    console.error(`${MLOG} calculatePlanMargins outer error: ${err.message}`);
  }
}
