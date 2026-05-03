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
// CAPITAL MANAGER — calculatePlanMargins  (Dual-Mode: API primary, SPAN fallback)
//
// Fully autonomous — no import from smc-kotak-neo-v3 or te-kotak-neo-v3.
// The on-disk scrip master CSV is the sole data source.
//
// Mode 1 (API — primary, requires live session):
//   EL.getQuote → live LTP → snap to ATM
//   Per leg: parseStrikeSpec + getOTMStrike → token from CSV tokenMap
//   → EL.checkMargin → sum ordMrgn per block
//
// Mode 2 (SPAN fallback — pre-market / token missing / API down):
//   CSV put-call parity ATM (col 58 pScripBasePrice ÷ 100)
//   Per leg: csvPremium × spanRate × lotSize × lotMultiplier × lots
//   SELL subtracts, BUY adds; block result = |total|
//
// Both modes:
//   UT block = uptrendLegs + neutralLegs  (combined before compute)
//   DT block = downtrendLegs + neutralLegs
//   estimatedMargin = max(UT, DT)
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

// Kotak 1980 epoch → YYYY-MM-DD.
// Mirrors SMC's locked parseExpiryDate [SMC-1] without importing it.
// Kotak timestamps are seconds since 1980; + 315_532_800 converts to Unix seconds.
function cmParseExpiryEpoch(raw: string): string | null {
  const trimmed = raw.trim().replace(/"/g, "");
  const asMs = Number(trimmed);
  if (!isNaN(asMs) && asMs > 946684800000) {
    const d = new Date(asMs);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  const asSec = Number(trimmed);
  if (!isNaN(asSec) && asSec > 946684800 && asSec < 4102444800) {
    const d = new Date((asSec + 315_532_800) * 1000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  return null;
}

// Deep-walk checkMargin response for the margin value field.
function cmExtractOrdMrgn(data: unknown): number {
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

// ─── CSV: build token map + price map for a specific ticker + expiry ──────────
//
// Single CSV pass. Column layout (1-indexed → array index):
//   col  1 (idx  0) → pSymbol        token string
//   col  5 (idx  4) → pSymbolName    base ticker  (e.g. "NIFTY")
//   col  7 (idx  6) → pOptionType    "CE" / "PE" / "XX"
//   col 18 (idx 17) → lExpiryDate    Kotak 1980 epoch → cmParseExpiryEpoch
//   col 21 (idx 20) → dStrikePrice   strike × 100
//   col 58 (idx 57) → pScripBasePrice price  × 100
//
// Returns:
//   tokenMap  — Map<"${strike}_${optType}", token>
//   priceMap  — Map<strike, {CE?, PE?}>
//   atmStrike — snapped via put-call parity + getATMStrike
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

    const price = Number(cols[57]?.trim().replace(/"/g, "")) / 100;
    if (isNaN(price) || price <= 0) continue;

    tokenMap.set(`${strike}_${optType}`, token);
    const existing = priceMap.get(strike) ?? {};
    if (optType === "CE") existing.CE = price;
    else existing.PE = price;
    priceMap.set(strike, existing);
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
      console.warn(`${MLOG}   ${blockLabel} API: checkMargin failed (${(marginRes as any).error})`);
      anyFailed = true;
    } else {
      const mrgn = cmExtractOrdMrgn(marginRes.data);
      if (mrgn <= 0) {
        console.warn(`${MLOG}   ${blockLabel} API: ordMrgn not found or zero in response — treating as failure`);
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

        // 7. productMode — resolved from block config objects (same lookup order used by TE/SMC)
        const productMode = (
          (tradeParams.uptrendConfig as any)?.productMode  ||
          (tradeParams.downtrendConfig as any)?.productMode ||
          (tradeParams.neutralConfig as any)?.productMode  ||
          (tradeParams.legsConfig as any)?.productMode     ||
          "MIS"
        ) as string;

        // 8. Try Mode 1: API (only when broker session is live)
        let utMargin = 0;
        let dtMargin = 0;
        let usedMode = "SPAN";

        if (brokerConfig.isConnected && brokerConfig.accessToken) {
          console.log(`${MLOG} Plan "${plan.name}" — trying API mode`);
          let apiAtmStrike = atmStrike;
          try {
            const quoteRes = await EL.getQuote(brokerConfig, EL.mapExchange(exchange), instrumentConfig.token ?? "");
            if (quoteRes.success && quoteRes.ltp && quoteRes.ltp > 0) {
              apiAtmStrike = getATMStrike(quoteRes.ltp, strikeInterval);
              console.log(`${MLOG} Plan "${plan.name}" — LTP=${quoteRes.ltp} → live ATM=${apiAtmStrike}`);
            }
          } catch { /* non-fatal — use CSV ATM */ }

          const [utRes, dtRes] = await Promise.all([
            cmApiBlock(utLegs, apiAtmStrike, strikeInterval, tokenMap, lotSize, lotMultiplier, brokerConfig, exchange, productMode, "UT"),
            cmApiBlock(dtLegs, apiAtmStrike, strikeInterval, tokenMap, lotSize, lotMultiplier, brokerConfig, exchange, productMode, "DT"),
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
