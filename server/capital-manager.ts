// ═══════════════════════════════════════════════════════════════════════════════
// CAPITAL MANAGER
// Refreshes available capital per UCC from the broker API and persists snapshots
// to broker_capital_snapshots. TE reads these instead of calling getLimits live.
// ═══════════════════════════════════════════════════════════════════════════════
import type { IStorage } from "./storage";
import EL from "./el-kotak-neo-v3";

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
