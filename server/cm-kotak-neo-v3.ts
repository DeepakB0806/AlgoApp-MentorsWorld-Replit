// ═══════════════════════════════════════════════════════════════════════════════
// CAPITAL MANAGER  (cm-kotak-neo-v3)
// Refreshes available capital per UCC from the broker API and persists
// snapshots to broker_capital_snapshots. TE reads these instead of calling
// getLimits live.
//
// calculatePlanMargins — pure CSV SPAN engine, zero Kotak API calls.
// ATM is derived from put-call parity by reading today's on-disk scrip master
// CSV (col 58 pScripBasePrice) from process.cwd().
// Margin = SPAN rate × targetStrike × lotSize × lotMultiplier × sellLots.
// UT and DT are computed separately; estimatedMargin = max(UT, DT).
// ═══════════════════════════════════════════════════════════════════════════════
import fs from "fs";
import path from "path";
import type { IStorage } from "./storage";
import type { BrokerConfig } from "@shared/schema";
import EL from "./el-kotak-neo-v3";
import { parseTradeParams } from "./te-kotak-neo-v3";
import { liveContractCache } from "./smc-kotak-neo-v3";
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

// ─── Scheduler ───────────────────────────────────────────────────────────────
let capitalRefreshTimer: ReturnType<typeof setTimeout> | null = null;

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

export async function startCapitalManager(storage: IStorage): Promise<void> {
  try {
    await refreshAllCapital(storage);
  } catch (err) {
    console.warn(`${LOG} Startup refresh warning: ${err}`);
  }
  scheduleNextCapitalRefresh(storage);
}

// ═══════════════════════════════════════════════════════════════════════════════
// CAPITAL MANAGER — calculatePlanMargins  (pure CSV SPAN engine)
//
// Zero Kotak API calls. ATM is derived from put-call parity:
//   read today's on-disk scrip_master_{exchange}_{date}.csv from process.cwd(),
//   scan col 58 (pScripBasePrice ÷ 100) for the target expiry's CE and PE
//   tokens; find strike where |CE_price − PE_price| is minimum; snap to
//   strikeInterval via getATMStrike. Returns null if disk file is absent.
//
// Margin formula per SELL leg:
//   spanRate × targetStrike × lotSize × lotMultiplier × leg.lots
// BUY legs contribute ₹0.
//
// UT = SELL margins from uptrendLegs  + SELL margins from neutralLegs
// DT = SELL margins from downtrendLegs + SELL margins from neutralLegs
// estimatedMargin = max(UT, DT)
//
// On expiry day (today IST == targetExpiryDate) the effective SPAN rate is
// scaled by expiry_day_span_multiplier (default 1.5×).
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Private helpers ──────────────────────────────────────────────────────────

// Return leg array for a given blockType from parsed tradeParams.
function cmSelectLegs(tradeParams: Record<string, any>, blockType: string): any[] {
  const legs = tradeParams[blockType];
  return Array.isArray(legs) ? legs : [];
}

// True if today IST matches the target expiry date string (YYYY-MM-DD).
function cmIsExpiryDay(targetExpiryDate: string): boolean {
  const todayIST = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
  return todayIST === targetExpiryDate;
}

// Read the on-disk CSV for the given exchange and today's IST date to find ATM
// via put-call parity. Filename matches SMC's write pattern:
//   scrip_master_{exchange.toLowerCase()}_{YYYY-MM-DD}.csv  in process.cwd()
//
// CSV column indices (1-indexed, i.e. array index = col - 1):
//   col  1  → pSymbol       (token, string)
//   col  5  → pSymbolName   (ticker)
//   col  7  → pOptionType   ("CE" / "PE" / "XX")
//   col 18  → lExpiryDate   (epoch seconds since Kotak 1980 epoch — not used here)
//   col 21  → dStrikePrice  (strike × 100)
//   col 58  → pScripBasePrice (base price × 100)
//
// We use liveContractCache (already keyed by ticker_date_strike_optType) to
// identify which tokens belong to the target expiry — no CSV date parsing needed.
// Returns null if the disk file is absent.
function cmFindAtmFromCsv(
  ticker: string,
  exchange: string,
  targetExpiryDate: string,
  strikeInterval: number,
): number | null {
  const MLOG = "[MARGIN-CALC]";

  // Step 1: collect token → {strike, optType} from liveContractCache
  const tokenMeta = new Map<string, { strike: number; optType: string }>();
  for (const key of liveContractCache.keys()) {
    if (!key.startsWith(`${ticker}_${targetExpiryDate}_`)) continue;
    const parts = key.split("_");
    if (parts.length !== 4) continue;
    const strike = Number(parts[2]);
    const optType = parts[3];
    if (isNaN(strike) || strike <= 0) continue;
    if (optType !== "CE" && optType !== "PE") continue;
    const entry = liveContractCache.get(key);
    if (entry?.token) tokenMeta.set(entry.token, { strike, optType });
  }

  if (tokenMeta.size === 0) {
    console.warn(`${MLOG} cmFindAtmFromCsv: no cache keys for ${ticker}_${targetExpiryDate}`);
    return null;
  }

  // Step 2: read raw CSV from disk (SMC writes then discards the text from RAM;
  // the on-disk file is the only reliable source)
  const todayIST = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
  const csvFilename = `scrip_master_${exchange.toLowerCase()}_${todayIST}.csv`;
  const csvFilePath = path.resolve(process.cwd(), csvFilename);
  if (!fs.existsSync(csvFilePath)) {
    console.warn(`${MLOG} cmFindAtmFromCsv: disk CSV not found (${csvFilename}) — run scrip sync first`);
    return null;
  }
  const rawCsv = fs.readFileSync(csvFilePath, "utf-8");

  // Step 3: scan CSV rows; read col 1 (token) and col 58 (pScripBasePrice ÷ 100)
  const strikePrices = new Map<number, { CE?: number; PE?: number }>();

  const lines = rawCsv.split("\n");
  for (const line of lines) {
    if (!line.trim()) continue;
    const cols = line.split(",");
    if (cols.length < 58) continue;

    const token = cols[0].trim().replace(/"/g, "");
    const meta = tokenMeta.get(token);
    if (!meta) continue;

    const rawPrice = cols[57].trim().replace(/"/g, "");
    const price = Number(rawPrice) / 100;
    if (isNaN(price) || price <= 0) continue;

    const existing = strikePrices.get(meta.strike) ?? {};
    if (meta.optType === "CE") existing.CE = price;
    else if (meta.optType === "PE") existing.PE = price;
    strikePrices.set(meta.strike, existing);
  }

  if (strikePrices.size === 0) {
    console.warn(`${MLOG} cmFindAtmFromCsv: no prices found in CSV for ${ticker}_${targetExpiryDate}`);
    return null;
  }

  // Step 4: put-call parity — find strike where |CE − PE| is minimum
  let bestStrike: number | null = null;
  let bestDiff = Infinity;

  for (const [strike, prices] of strikePrices) {
    if (prices.CE === undefined || prices.PE === undefined) continue;
    const diff = Math.abs(prices.CE - prices.PE);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestStrike = strike;
    }
  }

  if (bestStrike === null) {
    console.warn(`${MLOG} cmFindAtmFromCsv: could not find paired CE+PE for ${ticker}_${targetExpiryDate}`);
    return null;
  }

  const strikePair = strikePrices.get(bestStrike)!;
  console.log(
    `${MLOG} ATM=${bestStrike} via put-call parity (|CE-PE|=${bestDiff.toFixed(2)}, CE=${strikePair.CE?.toFixed(2)}, PE=${strikePair.PE?.toFixed(2)})`,
  );

  return getATMStrike(bestStrike, strikeInterval);
}

// Compute net SPAN margin for a list of legs — works for any strategy type.
//
// For every leg:
//   contribution = spanRate × resolvedStrike × lotSize × lotMultiplier × lots
//   SELL → total -= contribution  (you receive — negative)
//   BUY  → total += contribution  (you pay     — positive)
// Returns Math.abs(total) so the result is always positive.
//
// This handles all strategy types uniformly:
//   Option buying  (all BUY)  → |0 − BUY_sum|       = BUY_sum
//   Option selling (SELL+BUY) → |SELL_sum − BUY_sum| = net margin
//   SELL-only                 → |SELL_sum − 0|       = SELL_sum
//
// lotSize comes from instrumentConfig per index — never hardcoded.
function cmComputeBlockMargin(
  legs: any[],
  atmStrike: number,
  strikeInterval: number,
  lotSize: number,
  lotMultiplier: number,
  effectiveSpanRate: number,
  blockLabel: string,
): number {
  const MLOG = "[MARGIN-CALC]";
  let total = 0;

  for (const leg of legs) {
    const legType = (leg.type || "").toUpperCase() as "CE" | "PE" | "FUT";
    if (legType !== "CE" && legType !== "PE" && legType !== "FUT") continue;

    const legAction = (leg.action || "SELL").toUpperCase();

    let targetStrike: number;
    if (legType === "FUT") {
      targetStrike = atmStrike;
    } else {
      const spec = parseStrikeSpec(leg.strike || "ATM");
      targetStrike = getOTMStrike(atmStrike, spec, strikeInterval, legType as "CE" | "PE");
    }

    const lots = leg.lots || 1;
    const contribution = effectiveSpanRate * targetStrike * lotSize * lotMultiplier * lots;

    if (legAction === "SELL") {
      total -= contribution;
      console.log(`${MLOG}   ${blockLabel} SELL ${legType} strike=${targetStrike} lots=${lots}×${lotMultiplier}×${lotSize} −₹${contribution.toFixed(2)}`);
    } else {
      total += contribution;
      console.log(`${MLOG}   ${blockLabel} BUY  ${legType} strike=${targetStrike} lots=${lots}×${lotMultiplier}×${lotSize} +₹${contribution.toFixed(2)}`);
    }
  }

  return Math.abs(total);
}

// ─── calculatePlanMargins ────────────────────────────────────────────────────
// Signature identical to the old version for drop-in compatibility.
// Runs after SMC's sync and overwrites estimatedMargin with correct values.
export async function calculatePlanMargins(
  storage: IStorage,
  brokerConfig: BrokerConfig,
): Promise<void> {
  const MLOG = "[MARGIN-CALC]";
  try {
    // ── Read SPAN settings (defaults: 5.0% and 1.5×) ────────────────────────
    const spanRateSetting = await storage.getSetting("span_rate_percent");
    const expiryMultSetting = await storage.getSetting("expiry_day_span_multiplier");
    const parsedSpanRate = parseFloat(spanRateSetting?.value || "");
    const parsedExpiryMult = parseFloat(expiryMultSetting?.value || "");
    const baseSpanRate = (isNaN(parsedSpanRate) || parsedSpanRate <= 0) ? 0.05 : parsedSpanRate / 100;
    const expiryMultiplier = (isNaN(parsedExpiryMult) || parsedExpiryMult < 1) ? 1.5 : parsedExpiryMult;

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
        // ── 1. Parse tradeParams ─────────────────────────────────────────────
        const tradeParams = parseTradeParams(plan);
        if (!tradeParams) {
          console.warn(`${MLOG} Plan "${plan.name}" — tradeParams missing or invalid, skipping`);
          continue;
        }

        const ticker = plan.ticker;
        const exchange = plan.exchange;

        if (!ticker || !exchange || !isOptionExchange(exchange)) {
          console.warn(`${MLOG} Plan "${plan.name}" — no ticker/exchange or non-option exchange, skipping`);
          continue;
        }

        // ── 2. Get instrumentConfig ──────────────────────────────────────────
        const instrumentConfig = await storage.getInstrumentConfig(ticker, exchange);
        if (!instrumentConfig) {
          console.warn(`${MLOG} Plan "${plan.name}" — no instrumentConfig for ${ticker}/${exchange}, skipping`);
          continue;
        }

        const strikeInterval = instrumentConfig.strikeInterval ?? 50;
        const lotSize = instrumentConfig.lotSize ?? 1;
        const lotMultiplier = plan.lotMultiplier || 1;

        // ── 3. Resolve target expiry via plan's timeLogic ────────────────────
        const expiryDay = instrumentConfig.expiryDay;
        if (!expiryDay) {
          console.warn(`${MLOG} Plan "${plan.name}" — expiryDay missing in instrumentConfig, skipping`);
          continue;
        }
        const timeLogic = tradeParams.timeLogic as { expiryType?: string; expiryWeekOffset?: number } | undefined;
        const expiryType = timeLogic?.expiryType || "weekly";
        const weekOffset = timeLogic?.expiryWeekOffset || 0;

        const targetDate = getTargetExpiry(expiryDay, expiryType, weekOffset);
        const ey = targetDate.getFullYear();
        const em = String(targetDate.getMonth() + 1).padStart(2, "0");
        const ed = String(targetDate.getDate()).padStart(2, "0");
        const targetExpiryDate = `${ey}-${em}-${ed}`;

        console.log(`${MLOG} Plan "${plan.name}" — expiry resolved: ${expiryDay} ${expiryType} offset=${weekOffset} → ${targetExpiryDate}`);

        // ── 4. Expiry-day multiplier ─────────────────────────────────────────
        const isExpiry = cmIsExpiryDay(targetExpiryDate);
        const effectiveSpanRate = baseSpanRate * (isExpiry ? expiryMultiplier : 1);
        if (isExpiry) {
          console.log(`${MLOG} Plan "${plan.name}" — EXPIRY DAY: SPAN rate ×${expiryMultiplier} → ${(effectiveSpanRate * 100).toFixed(2)}%`);
        }

        // ── 5. Derive ATM from CSV put-call parity ───────────────────────────
        const atmStrike = cmFindAtmFromCsv(ticker, exchange, targetExpiryDate, strikeInterval);
        if (atmStrike === null) {
          console.warn(`${MLOG} Plan "${plan.name}" — ATM unavailable from CSV for ${targetExpiryDate}; skipping`);
          continue;
        }
        console.log(`${MLOG} Plan "${plan.name}" — ATM=${atmStrike} (${ticker} ${targetExpiryDate})`);

        // ── 6. Compute UT and DT margins separately ──────────────────────────
        const uptrendLegs   = cmSelectLegs(tradeParams, "uptrendLegs");
        const downtrendLegs = cmSelectLegs(tradeParams, "downtrendLegs");
        const neutralLegs   = cmSelectLegs(tradeParams, "neutralLegs");

        const neutralMargin = cmComputeBlockMargin(
          neutralLegs, atmStrike, strikeInterval, lotSize, lotMultiplier, effectiveSpanRate, "neutralLegs",
        );
        const utMargin = cmComputeBlockMargin(
          uptrendLegs, atmStrike, strikeInterval, lotSize, lotMultiplier, effectiveSpanRate, "uptrendLegs",
        ) + neutralMargin;
        const dtMargin = cmComputeBlockMargin(
          downtrendLegs, atmStrike, strikeInterval, lotSize, lotMultiplier, effectiveSpanRate, "downtrendLegs",
        ) + neutralMargin;

        const totalMargin = Math.max(utMargin, dtMargin);
        console.log(`${MLOG} Plan "${plan.name}" — UT=₹${utMargin.toFixed(2)} DT=₹${dtMargin.toFixed(2)} → estimatedMargin=₹${totalMargin.toFixed(2)}`);

        // ── 7. Persist result ────────────────────────────────────────────────
        await storage.updateStrategyPlan(plan.id, {
          estimatedMargin: String(totalMargin.toFixed(2)),
          marginCalculatedAt: new Date().toISOString(),
        });
        console.log(`${MLOG} Plan "${plan.name}" — persisted ₹${totalMargin.toFixed(2)}`);
      } catch (planErr: any) {
        console.error(`${MLOG} Plan "${plan.name}" — unexpected error: ${planErr.message}`);
      }
    }

    // ── E2: Invalidate plan cache so TE reads fresh estimatedMargin ──────────
    tradingCache.invalidatePlans(brokerConfig.id);
    console.log(`${MLOG} Cache invalidated for broker ${brokerConfig.name}`);
  } catch (err: any) {
    console.error(`${MLOG} calculatePlanMargins outer error: ${err.message}`);
  }
}
