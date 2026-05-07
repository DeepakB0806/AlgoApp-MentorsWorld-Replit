// ═══════════════════════════════════════════════════════════════════════════════
// CAPITAL MANAGER  (cm-kotak-neo-v3)
// Refreshes available capital per UCC from the broker API and persists
// snapshots to broker_capital_snapshots. TE reads these instead of calling
// getLimits live.
//
// calculatePlanMargins — Distance-SPAN margin engine. Primary-broker only.
//   Reads per-index spanRate + exposureRate from index_margin_settings.
//   Long BUY : premium × lotSize × lots (no SPAN/Exposure charge).
//   Naked SELL: (atmStrike × lotSize) × (spanRate + exposureRate) × lots.
//   Hedged SELL+BUY: (|sellStrike−buyStrike| × lotSize + atmStrike × lotSize × exposureRate) × lots.
//   Expiry day: effectiveSpanRate = spanRate × expiryMultiplier (SEBI ELM).
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
// CAPITAL MANAGER — calculatePlanMargins  (Distance-SPAN Engine)
// Primary-only: returns immediately for non-primary broker configs.
// Rates (spanRate, exposureRate, expiryMultiplier) read per-index from
// index_margin_settings; falls back to app_settings global values.
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

// ─── Distance-SPAN: pair SELL legs with BUY legs, compute block margin ────────
interface LegR { strike: number; effectiveLots: number; premium: number }

function cmPairLegs(
  sells: LegR[],
  buys:  LegR[],
  atmStrike: number,
  lotSize: number,
  effectiveSpanRate: number,
  exposureRate: number,
  typeLabel: string,
  blockLabel: string,
): number {
  const MLOG = "[DISTANCE-SPAN]";
  // Sort ascending by |strike − ATM| — closest-to-ATM sell paired with closest-to-ATM buy first
  const sortedSells = [...sells].sort((a, b) => Math.abs(a.strike - atmStrike) - Math.abs(b.strike - atmStrike));
  const sortedBuys  = [...buys ].sort((a, b) => Math.abs(a.strike - atmStrike) - Math.abs(b.strike - atmStrike));
  const remS = sortedSells.map(s => s.effectiveLots);
  const remB = sortedBuys .map(b => b.effectiveLots);
  let total = 0, si = 0, bi = 0;

  // Hedged pairs: strike distance + exposure buffer
  while (si < sortedSells.length && bi < sortedBuys.length) {
    const sell = sortedSells[si], buy = sortedBuys[bi];
    const hedgeLots = Math.min(remS[si], remB[bi]);
    const hedgeM = (Math.abs(sell.strike - buy.strike) * lotSize + atmStrike * lotSize * exposureRate) * hedgeLots;
    total += hedgeM;
    console.log(`${MLOG} ${blockLabel} HEDGED ${typeLabel} S@${sell.strike}/B@${buy.strike} lots=${hedgeLots} req=₹${hedgeM.toFixed(2)}`);
    remS[si] -= hedgeLots; remB[bi] -= hedgeLots;
    if (remS[si] <= 0) si++;
    if (remB[bi] <= 0) bi++;
  }

  // Leftover naked sells: full SPAN + Exposure on atmStrike
  while (si < sortedSells.length) {
    const nakedM = atmStrike * lotSize * (effectiveSpanRate + exposureRate) * remS[si];
    total += nakedM;
    console.log(`${MLOG} ${blockLabel} NAKED SELL ${typeLabel} @${sortedSells[si].strike} lots=${remS[si]} req=₹${nakedM.toFixed(2)}`);
    si++;
  }

  // Leftover long buys: premium cost only (no SPAN/Exposure)
  while (bi < sortedBuys.length) {
    const buyM = sortedBuys[bi].premium * lotSize * remB[bi];
    total += buyM;
    console.log(`${MLOG} ${blockLabel} LONG ${typeLabel} @${sortedBuys[bi].strike} prem=₹${sortedBuys[bi].premium.toFixed(2)} lots=${remB[bi]} req=₹${buyM.toFixed(2)}`);
    bi++;
  }

  return total;
}

// ─── Distance-SPAN block ───────────────────────────────────────────────────────
// Live LTP (EL.getQuote, 50ms gap between calls) → CSV priceMap → DEFAULT 150.
// effectiveSpanRate must already encode the expiry multiplier (applied once before calling).
async function cmDistanceSpanBlock(
  legs: any[],
  atmStrike: number,
  strikeInterval: number,
  tokenMap: Map<string, string>,
  priceMap: Map<number, { CE?: number; PE?: number }>,
  effectiveSpanRate: number,
  exposureRate: number,
  lotSize: number,
  lotMultiplier: number,
  brokerConfig: BrokerConfig,
  exchange: string,
  blockLabel: string,
): Promise<number> {
  const MLOG = "[DISTANCE-SPAN]";
  const mappedEx = EL.mapExchange(exchange);
  const ceSells: LegR[] = [], ceBuys: LegR[] = [], peSells: LegR[] = [], peBuys: LegR[] = [];

  for (const leg of legs) {
    const legType = (leg.type || "").toUpperCase();
    if (legType !== "CE" && legType !== "PE") continue; // FUT not supported by Distance-SPAN
    const legAction     = (leg.action || "SELL").toUpperCase();
    const effectiveLots = (leg.lots || 1) * lotMultiplier;
    const spec          = parseStrikeSpec(leg.strike || "ATM");
    const resolvedStrike = getOTMStrike(atmStrike, spec, strikeInterval, legType as "CE" | "PE");

    // Premium: live LTP (50ms gap) → CSV priceMap → DEFAULT 150
    let premium = 150;
    const csvEntry = priceMap.get(resolvedStrike);
    if (csvEntry) {
      const csvP = legType === "CE" ? csvEntry.CE : csvEntry.PE;
      if (csvP !== undefined && csvP > 0) premium = csvP;
    }
    if (brokerConfig.isConnected && brokerConfig.accessToken) {
      const token = tokenMap.get(`${resolvedStrike}_${legType}`);
      if (token) {
        try {
          await new Promise(r => setTimeout(r, 50));
          const qRes = await EL.getQuote(brokerConfig, mappedEx, token);
          if (qRes.success && qRes.ltp && qRes.ltp > 0 && qRes.ltp < strikeInterval * 200) {
            premium = qRes.ltp;
          }
        } catch { /* non-fatal — use CSV/DEFAULT */ }
      }
    }

    const resolved: LegR = { strike: resolvedStrike, effectiveLots, premium };
    if (legType === "CE") { if (legAction === "SELL") ceSells.push(resolved); else ceBuys.push(resolved); }
    else                   { if (legAction === "SELL") peSells.push(resolved); else peBuys.push(resolved); }
  }

  const ceTotal = cmPairLegs(ceSells, ceBuys, atmStrike, lotSize, effectiveSpanRate, exposureRate, "CE", blockLabel);
  const peTotal = cmPairLegs(peSells, peBuys, atmStrike, lotSize, effectiveSpanRate, exposureRate, "PE", blockLabel);
  const blockTotal = ceTotal + peTotal;
  console.log(`${MLOG} ${blockLabel} CE=₹${ceTotal.toFixed(2)} PE=₹${peTotal.toFixed(2)} total=₹${blockTotal.toFixed(2)}`);
  return blockTotal;
}

// ─── calculatePlanMargins ────────────────────────────────────────────────────
export async function calculatePlanMargins(
  storage: IStorage,
  brokerConfig: BrokerConfig,
): Promise<void> {
  const MLOG = "[MARGIN-CALC]";
  try {
    // 0. Primary-only guard — one calculation per cycle regardless of connected user count
    if (!brokerConfig.isPrimary) {
      console.log(`${MLOG} Skipping — not primary broker (${brokerConfig.name})`);
      return;
    }

    // Global fallback rates (used when index_margin_settings has no row for this ticker)
    const spanRateSetting     = await storage.getSetting("span_rate_percent");
    const expiryMultSetting   = await storage.getSetting("expiry_day_span_multiplier");
    const expRateSetting      = await storage.getSetting("exposure_rate_percent");
    const parsedSpanRate      = parseFloat(spanRateSetting?.value   || "");
    const parsedExpiryMult    = parseFloat(expiryMultSetting?.value || "");
    const parsedExpRate       = parseFloat(expRateSetting?.value    || "");
    const globalBaseSpanRate  = (isNaN(parsedSpanRate)   || parsedSpanRate   <= 0) ? 10.0 : parsedSpanRate;
    const globalExpiryMult    = (isNaN(parsedExpiryMult) || parsedExpiryMult < 1)  ? 1.5  : parsedExpiryMult;
    const globalExposureRate  = (isNaN(parsedExpRate)    || parsedExpRate    <= 0)  ? 2.0  : parsedExpRate;

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
    console.log(`${MLOG} Calculating margins for ${plansToCalc.length} plan(s) — broker ${brokerConfig.name} [DISTANCE-SPAN]`);

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

        // 2.5. Per-index rates from index_margin_settings (falls back to global app_settings)
        const idxSetting      = await storage.getIndexMarginSetting(ticker);
        const spanPct         = idxSetting ? parseFloat(idxSetting.spanRate)         : NaN;
        const expPct          = idxSetting ? parseFloat(idxSetting.exposureRate)      : NaN;
        const expMultFromIdx  = idxSetting ? parseFloat(idxSetting.expiryMultiplier)  : NaN;
        const baseSpanRate     = (!isNaN(spanPct)        && spanPct        > 0) ? spanPct        / 100 : globalBaseSpanRate / 100;
        const exposureRate     = (!isNaN(expPct)         && expPct         > 0) ? expPct         / 100 : globalExposureRate  / 100;
        const expiryMultiplier = (!isNaN(expMultFromIdx) && expMultFromIdx >= 1) ? expMultFromIdx       : globalExpiryMult;
        const rateSource = idxSetting ? "index_margin_settings" : "global_app_settings";
        console.log(`${MLOG} Plan "${plan.name}" — rates: span=${(baseSpanRate * 100).toFixed(1)}% exp=${(exposureRate * 100).toFixed(1)}% expMult=${expiryMultiplier} (${rateSource})`);

        // 3. Resolve target expiry (respects expiryWeekOffset)
        const timeLogic        = tradeParams.timeLogic as { expiryType?: string; expiryWeekOffset?: number } | undefined;
        const expiryType       = timeLogic?.expiryType || "weekly";
        const weekOffset       = timeLogic?.expiryWeekOffset || 0;
        const targetDate       = getTargetExpiry(expiryDay, expiryType, weekOffset);
        const targetExpiryDate = `${targetDate.getFullYear()}-${String(targetDate.getMonth() + 1).padStart(2, "0")}-${String(targetDate.getDate()).padStart(2, "0")}`;
        console.log(`${MLOG} Plan "${plan.name}" — expiry: ${expiryDay} ${expiryType} offset=${weekOffset} → ${targetExpiryDate}`);

        // 4. Expiry-day multiplier applied once before calling the block (SEBI ELM)
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

        // 7. Optional live ATM refinement via EL.getQuote on instrument token
        let liveAtmStrike = atmStrike;
        if (brokerConfig.isConnected && brokerConfig.accessToken && instrumentConfig.token) {
          try {
            const quoteRes = await EL.getQuote(brokerConfig, EL.mapExchange(exchange), instrumentConfig.token);
            if (quoteRes.success && quoteRes.ltp && quoteRes.ltp > strikeInterval * 200) {
              liveAtmStrike = getATMStrike(quoteRes.ltp, strikeInterval);
              console.log(`${MLOG} Plan "${plan.name}" — LTP=${quoteRes.ltp} → live ATM=${liveAtmStrike}`);
            }
          } catch { /* non-fatal — keep CSV parity ATM */ }
        }

        // 8. Distance-SPAN engine (UT then DT, sequential to respect 50ms/call API rate)
        const utMargin = await cmDistanceSpanBlock(utLegs, liveAtmStrike, strikeInterval, tokenMap, priceMap, effectiveSpanRate, exposureRate, lotSize, lotMultiplier, brokerConfig, exchange, "UT");
        const dtMargin = await cmDistanceSpanBlock(dtLegs, liveAtmStrike, strikeInterval, tokenMap, priceMap, effectiveSpanRate, exposureRate, lotSize, lotMultiplier, brokerConfig, exchange, "DT");
        const totalMargin = Math.max(utMargin, dtMargin);
        console.log(`${MLOG} Plan "${plan.name}" [DISTANCE-SPAN] UT=₹${utMargin.toFixed(2)} DT=₹${dtMargin.toFixed(2)} → estimatedMargin=₹${totalMargin.toFixed(2)}`);

        // 9. Persist
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
