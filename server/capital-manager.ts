// ═══════════════════════════════════════════════════════════════════════════════
// CAPITAL MANAGER
// Refreshes available capital per UCC from the broker API and persists snapshots
// to broker_capital_snapshots. TE reads these instead of calling getLimits live.
// ═══════════════════════════════════════════════════════════════════════════════
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
// Moved here from te-kotak-neo-v3.ts so TE can import from capital-manager.
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
// CAPITAL MANAGER — calculatePlanMargins
//
// DESIGN: Pure consumer. Imports public exports from te-kotak-neo-v3,
// smc-kotak-neo-v3, and option-symbol-builder — does NOT modify any of them.
// te-kotak-neo-v3.ts and smc-kotak-neo-v3.ts are permanently frozen by user
// directive. No other file in the codebase is modified by this function.
//
// WHY THIS EXISTS: SMC's calculatePlanMargins has three correctness bugs:
//   1. Wrong expiry  — uses findNearestExpiryDate() instead of getTargetExpiry()
//                      so plans with expiryWeekOffset>0 look up the wrong week's
//                      contracts entirely.
//   2. Wrong strike  — uses flat ATM for every leg instead of per-leg
//                      getOTMStrike(), so "OTM 5" legs are priced at ATM.
//   3. Wrong sign    — ADDs every leg unconditionally; neutralLegs BUY hedges
//                      reduce net SPAN margin (spread benefit) and must SUBTRACT.
//
// SMC's version continues to run unchanged inside runScripMasterSync. This
// version runs immediately after each sync and overwrites the DB values with
// correct figures. The overwrite gap is milliseconds — not a race condition.
//
// BUY/SELL accounting sign table:
//   uptrendLegs  / downtrendLegs — any action → ADD
//   neutralLegs  — SELL          → ADD
//   neutralLegs  — BUY           → SUBTRACT  (hedge reduces net SPAN requirement)
//   legs (legacy) — any          → ADD
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Private helpers (margin calc only) ──────────────────────────────────────

// Deep-search the checkMargin API response for the margin value field.
// Kotak may return ordMrgn at various nesting levels depending on API version.
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

// Return the leg array for a given blockType from parsed tradeParams.
function cmSelectLegs(tradeParams: Record<string, any>, blockType: string): any[] {
  const legs = tradeParams[blockType];
  return Array.isArray(legs) ? legs : [];
}

// Return the block config object for a given blockType.
// Maps: uptrendLegs → uptrendConfig, downtrendLegs → downtrendConfig,
//       neutralLegs → neutralConfig, legs → legsConfig.
function cmGetBlockConfig(tradeParams: Record<string, any>, blockType: string): Record<string, any> {
  const configKey = blockType === "legs"
    ? "legsConfig"
    : blockType.replace("Legs", "Config");
  const cfg = tradeParams[configKey];
  return (cfg && typeof cfg === "object" && !Array.isArray(cfg)) ? cfg : {};
}

// Resolve productMode for a given block, cascading through all blocks if the
// block's own config has no productMode set.
function cmResolveProductMode(tradeParams: Record<string, any>, blockType: string): string {
  return (
    cmGetBlockConfig(tradeParams, blockType).productMode ||
    cmGetBlockConfig(tradeParams, "uptrendLegs").productMode ||
    cmGetBlockConfig(tradeParams, "downtrendLegs").productMode ||
    cmGetBlockConfig(tradeParams, "neutralLegs").productMode ||
    cmGetBlockConfig(tradeParams, "legs").productMode ||
    "MIS"
  ) as string;
}

// Scan liveContractCache for strikes at ticker+expiryDate and return the
// median strike as an ATM approximation (used when live quote fails).
function cmFindAtmFromCache(ticker: string, expiryDate: string): number | null {
  const strikes: number[] = [];
  for (const key of liveContractCache.keys()) {
    if (!key.startsWith(`${ticker}_${expiryDate}_`)) continue;
    const parts = key.split("_");
    if (parts.length < 4) continue;
    const strike = Number(parts[2]);
    if (!isNaN(strike) && strike > 0) strikes.push(strike);
  }
  if (strikes.length === 0) return null;
  const sorted = [...new Set(strikes)].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

// Mirror of TE Invariant [6] holiday fallback scanner (TE lines 677–698).
// When NSE shifts a weekly expiry due to a holiday, the scrip master CSV
// stores the actual shifted date while getTargetExpiry returns the theoretical
// calendar date. Scan cache keys within a ±3-day window and return the nearest
// actual expiry key if the exact key misses.
// Cache key format: ${ticker}_${YYYY-MM-DD}_${strike}_${optType}
function cmHolidayFallback(
  ticker: string,
  targetExpiryDate: string,
  targetStrike: number,
  legType: string,
): string | null {
  let minDiff = Infinity;
  let bestKey: string | null = null;
  const targetTime = new Date(targetExpiryDate).getTime();
  const nowTime = new Date().setHours(0, 0, 0, 0);

  for (const key of liveContractCache.keys()) {
    const parts = key.split("_");
    if (parts.length !== 4) continue;
    const [keyTicker, keyDate, keyStrike, keyOptType] = parts;
    if (keyTicker !== ticker) continue;
    if (Number(keyStrike) !== Number(targetStrike)) continue;
    if (keyOptType !== legType) continue;
    const contractTime = new Date(keyDate).getTime();
    if (contractTime < nowTime) continue;
    const diff = Math.abs(contractTime - targetTime);
    if (diff < minDiff && diff <= 3 * 24 * 60 * 60 * 1000) {
      minDiff = diff;
      bestKey = key;
    }
  }
  return bestKey;
}

// ─── calculatePlanMargins ────────────────────────────────────────────────────
// Signature identical to SMC's exported version for drop-in compatibility.
// Runs after SMC's version and overwrites estimatedMargin with correct values.
export async function calculatePlanMargins(
  storage: IStorage,
  brokerConfig: BrokerConfig,
): Promise<void> {
  const MLOG = "[MARGIN-CALC]";
  try {
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
    console.log(`${MLOG} Calculating margins for ${plansToCalc.length} plan(s) — broker ${brokerConfig.name}`);

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
        if (!instrumentConfig.token) {
          console.warn(`${MLOG} Plan "${plan.name}" — instrumentConfig.token is null (E6), skipping`);
          continue;
        }

        const strikeInterval = instrumentConfig.strikeInterval ?? 50;
        const lotSize = instrumentConfig.lotSize ?? 1;
        const lotMultiplier = plan.lotMultiplier || 1;

        // ── 3. Resolve target expiry via plan's timeLogic (Bug 1 fix) ────────
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

        console.log(`${MLOG} Plan "${plan.name}" — expiry resolved: ${expiryDay} + ${expiryType} + offset=${weekOffset} → ${targetExpiryDate}`);

        // ── 4. Get spot LTP and compute ATM strike ───────────────────────────
        let atmStrike: number;
        const quoteRes = await EL.getQuote(brokerConfig, EL.mapExchange(exchange), instrumentConfig.token);
        if (quoteRes.success && quoteRes.ltp && quoteRes.ltp > 0) {
          atmStrike = getATMStrike(quoteRes.ltp, strikeInterval);
          console.log(`${MLOG} Plan "${plan.name}" — LTP=${quoteRes.ltp}, ATM=${atmStrike} (live)`);
        } else {
          // Pre-market or non-trading hours — fall back to median strike in cache
          const cacheAtm = cmFindAtmFromCache(ticker, targetExpiryDate);
          if (cacheAtm === null) {
            console.warn(`${MLOG} Plan "${plan.name}" — LTP unavailable and no cache strikes for ${targetExpiryDate}; skipping`);
            continue;
          }
          atmStrike = cacheAtm;
          console.log(`${MLOG} Plan "${plan.name}" — LTP unavailable (${quoteRes.error ?? "pre-market"}), cache ATM fallback: ${atmStrike}`);
        }

        // ── 5. Iterate all blocks with sign-aware accounting (Bug 2 + Bug 3 fix)
        let totalMargin = 0;
        let anyFailed = false;

        const BLOCKS: Array<{ blockType: string; sign: (action: string) => 1 | -1 }> = [
          { blockType: "uptrendLegs",   sign: () => 1 },
          { blockType: "downtrendLegs", sign: () => 1 },
          { blockType: "neutralLegs",   sign: (action) => action === "BUY" ? -1 : 1 },
          { blockType: "legs",          sign: () => 1 },
        ];

        for (const { blockType, sign } of BLOCKS) {
          const legs = cmSelectLegs(tradeParams, blockType);
          if (legs.length === 0) continue;

          const productMode = cmResolveProductMode(tradeParams, blockType);

          for (const leg of legs) {
            const legType = (leg.type || "").toUpperCase() as "CE" | "PE" | "FUT";
            if (legType !== "CE" && legType !== "PE" && legType !== "FUT") continue;

            const legAction = (leg.action || "SELL").toUpperCase();

            // ── Per-leg strike resolution (Bug 2 fix) ───────────────────────
            let targetStrike: number;
            if (legType === "FUT") {
              targetStrike = 0;
            } else {
              const spec = parseStrikeSpec(leg.strike || "ATM");
              targetStrike = getOTMStrike(atmStrike, spec, strikeInterval, legType as "CE" | "PE");
            }

            // ── Cache lookup with holiday fallback (mirrors TE Invariant [6]) ─
            const exactKey = `${ticker}_${targetExpiryDate}_${targetStrike}_${legType}`;
            let entry = liveContractCache.get(exactKey);
            let resolvedKey = exactKey;

            if (!entry) {
              console.warn(`${MLOG} Exact miss for ${exactKey} — running holiday fallback scan...`);
              const fallbackKey = cmHolidayFallback(ticker, targetExpiryDate, targetStrike, legType);
              if (fallbackKey) {
                entry = liveContractCache.get(fallbackKey)!;
                resolvedKey = fallbackKey;
                const fallbackDate = fallbackKey.split("_")[1];
                console.warn(`${MLOG} Holiday fallback: ${exactKey} → ${fallbackKey} (shifted by ${Math.abs(new Date(fallbackDate).getTime() - new Date(targetExpiryDate).getTime()) / 86400000}d)`);
              } else {
                console.warn(`${MLOG} Plan "${plan.name}" ${blockType} ${legType} ${targetStrike} — no cache entry even after ±3d fallback; marking failed`);
                anyFailed = true;
                continue;
              }
            }

            // ── E6: token null-check ─────────────────────────────────────────
            if (!entry.token) {
              console.warn(`${MLOG} Plan "${plan.name}" ${blockType} ${legType} ${targetStrike} — token null in cache (E6), skipping leg`);
              anyFailed = true;
              continue;
            }

            // ── E1: checkMargin with bypassTL=true ───────────────────────────
            const qty = String((leg.lots || 1) * lotMultiplier * lotSize);
            const marginRes = await EL.checkMargin(brokerConfig, {
              exSeg: EL.mapExchange(exchange),
              prc: "0",
              prcTp: "MKT",
              prod: productMode,
              qty,
              tok: entry.token,
              trnsTp: legAction === "BUY" ? "B" : "S",
              brkName: "KOTAK",
              brnchId: "ONLINE",
            }, true);

            if (!marginRes.success) {
              console.warn(`${MLOG} Plan "${plan.name}" ${blockType} ${legType} — checkMargin failed: ${(marginRes as any).error}`);
              anyFailed = true;
            } else {
              const legMargin = cmExtractOrdMrgn(marginRes.data);
              const appliedSign = sign(legAction);
              totalMargin += appliedSign * legMargin;

              const signLabel = appliedSign === -1 ? "DEDUCT" : "ADD";
              const signChar = appliedSign === -1 ? "−" : "+";
              console.log(`${MLOG} ${blockType} ${legAction} ${legType} ${resolvedKey.split("_")[2]} → ${signChar}₹${legMargin.toFixed(2)} (${signLabel})`);
            }

            // ── E13: 100ms rate-limit guard ──────────────────────────────────
            await new Promise(r => setTimeout(r, 100));
          }
        }

        // ── 6. Clamp negative total (hedge deductions exceeded SELL margin) ──
        if (totalMargin < 0) {
          console.warn(`${MLOG} Plan "${plan.name}" — hedge deductions exceeded SELL margin (₹${totalMargin.toFixed(2)}); clamping to 0`);
          totalMargin = 0;
        }

        // ── 7. Persist result ────────────────────────────────────────────────
        if (!anyFailed || totalMargin > 0) {
          await storage.updateStrategyPlan(plan.id, {
            estimatedMargin: String(totalMargin.toFixed(2)),
            marginCalculatedAt: new Date().toISOString(),
          });
          console.log(`${MLOG} Plan "${plan.name}" — ₹${totalMargin.toFixed(2)}${anyFailed ? " (partial — some legs skipped)" : ""}`);
        } else {
          console.warn(`${MLOG} Plan "${plan.name}" — all leg margin calls failed; estimatedMargin unchanged`);
        }
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
