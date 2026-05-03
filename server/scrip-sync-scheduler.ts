import type { IStorage } from "./storage";
import { runScripMasterSync, runScripMasterSyncPhaseB } from "./smc-kotak-neo-v3";
import type { BrokerConfig } from "@shared/schema";
import { calculatePlanMargins } from "./capital-manager";

// ── Intraday periodic refresh ───────────────────────────────────────────────
let intradayHandle: ReturnType<typeof setInterval> | null = null;
let lastIntradaySyncAt: number | null = null;

/**
 * Starts a 60-second polling loop that re-runs `runScripMasterSync` during
 * market hours (09:30–15:30 IST) whenever the user has configured a non-zero
 * `scrip_master_intraday_interval_mins` setting. Idempotent — calling a second
 * time while already running is a no-op.
 */
export function startIntradayScripRefresh(storage: IStorage): void {
  if (intradayHandle !== null) return;

  intradayHandle = setInterval(async () => {
    try {
      const setting = await storage.getSetting("scrip_master_intraday_interval_mins");
      const intervalMins = parseInt(setting?.value || "0", 10);
      if (!intervalMins || intervalMins <= 0) return;

      // Only fire between 09:30 and 15:30 IST
      const nowUTC = Date.now();
      const nowIST = new Date(nowUTC + 5.5 * 60 * 60 * 1000);
      const timeMinutes = nowIST.getUTCHours() * 60 + nowIST.getUTCMinutes();
      if (timeMinutes < 9 * 60 + 30 || timeMinutes > 15 * 60 + 30) return;

      // Enforce minimum interval between syncs
      if (lastIntradaySyncAt !== null) {
        const minsElapsed = (nowUTC - lastIntradaySyncAt) / 60_000;
        if (minsElapsed < intervalMins) return;
      }

      lastIntradaySyncAt = nowUTC;
      console.log(`[SCRIP-MASTER] Intraday refresh triggered (every ${intervalMins} min)`);

      const allBrokerConfigs = await storage.getBrokerConfigs();
      const liveBrokers = allBrokerConfigs.filter(
        (bc) => bc.isConnected && bc.brokerName === "kotak_neo",
      );
      if (liveBrokers.length === 0) return;

      // Phase A: CSV download once via primary (or first) connected broker
      const primaryBroker = liveBrokers.find(bc => bc.isPrimary) || liveBrokers[0];
      try {
        const result = await runScripMasterSync(storage, primaryBroker);
        if (result.success) {
          console.log(`[SCRIP-MASTER] Intraday refresh (Phase A): ${result.synced} contracts via ${primaryBroker.ucc || primaryBroker.id}`);
          await calculatePlanMargins(storage, primaryBroker).catch(err =>
            console.warn(`[SCRIP-MASTER] Capital margin calc error (intraday Phase A): ${err}`)
          );
        } else {
          console.warn(`[SCRIP-MASTER] Intraday refresh Phase A failed: ${result.error}`);
        }
      } catch (err) {
        console.warn(`[SCRIP-MASTER] Intraday refresh Phase A threw: ${err}`);
      }
      // Phase B: calculate margins for remaining brokers
      const otherBrokers = liveBrokers.filter(bc => bc.id !== primaryBroker.id);
      if (otherBrokers.length > 0) {
        await runScripMasterSyncPhaseB(storage, otherBrokers).catch(err =>
          console.warn(`[SCRIP-MASTER] Intraday refresh Phase B error: ${err}`)
        );
        for (const bc of otherBrokers) {
          await calculatePlanMargins(storage, bc).catch(err =>
            console.warn(`[SCRIP-MASTER] Capital margin calc error (intraday Phase B, ${bc.ucc}): ${err}`)
          );
        }
      }
    } catch (err) {
      console.warn(`[SCRIP-MASTER] Intraday refresh loop error: ${err}`);
    }
  }, 60_000);
}

// Module-level handles so any call to rescheduleScripMasterSync cancels the
// previous timer/interval before setting a new one. This allows the Settings UI
// to update the sync clock without a server restart.
let syncTimeoutHandle: ReturnType<typeof setTimeout> | null = null;
let syncIntervalHandle: ReturnType<typeof setInterval> | null = null;

// Per-broker retry timers — prevent overlapping retries for the same broker
const retryTimers = new Map<string, ReturnType<typeof setTimeout>>();

// Startup-phase retry timer — covers the case where getBrokerConfigs() itself
// fails (no broker context is available, so per-broker retries cannot be used)
let startupRetryTimer: ReturnType<typeof setTimeout> | null = null;

// In-memory recovery state — updated by retry functions, consumed by API route
export const scripRecoveryState = new Map<string, { isRecovering: boolean; recoveryAttempt: number }>();

export function getScripSyncStatus(brokerConfigId: string) {
  return scripRecoveryState.get(brokerConfigId) ?? { isRecovering: false, recoveryAttempt: 0 };
}

/**
 * Schedules a full startup-phase retry: re-fetches broker configs and then
 * attempts `runScripMasterSync` for each live broker. Used when the outer
 * `storage.getBrokerConfigs()` call itself throws at startup (e.g. DB timeout).
 * Falls back to `scheduleScripSyncRetry` for per-broker failures once configs
 * are available. Idempotent — a second call while a timer is already pending is
 * silently dropped.
 */
export function scheduleStartupScripSyncRetry(storage: IStorage, attempt: number): void {
  if (startupRetryTimer !== null) return;

  const delayMs = Math.min(5000 * attempt, 60_000);
  console.warn(
    `[SCRIP-MASTER] Auto-recovery: scheduling startup retry attempt ${attempt} in ${delayMs / 1000}s`,
  );

  startupRetryTimer = setTimeout(async () => {
    startupRetryTimer = null;
    try {
      const allBrokerConfigs = await storage.getBrokerConfigs();
      const liveBrokers = allBrokerConfigs.filter(bc => bc.isConnected && bc.brokerName === "kotak_neo");
      if (liveBrokers.length === 0) {
        console.log(`[SCRIP-MASTER] Startup auto-recovery attempt ${attempt}: no connected Kotak brokers, done`);
        return;
      }
      for (const bc of liveBrokers) {
        try {
          const result = await runScripMasterSync(storage, bc);
          if (result.success) {
            console.log(
              `[SCRIP-MASTER] Startup auto-recovery: recovered after ${attempt} attempt(s) — ${result.synced} contracts loaded`,
            );
            await calculatePlanMargins(storage, bc).catch(err =>
              console.warn(`[SCRIP-MASTER] Capital margin calc error (startup recovery): ${err}`)
            );
          } else {
            console.warn(`[SCRIP-MASTER] Startup auto-recovery attempt ${attempt} failed for broker ${bc.ucc || bc.id}: ${result.error}`);
            scheduleScripSyncRetry(storage, bc, 1);
          }
        } catch (err) {
          console.warn(`[SCRIP-MASTER] Startup auto-recovery attempt ${attempt} threw for broker ${bc.ucc || bc.id}: ${err}`);
          scheduleScripSyncRetry(storage, bc, 1);
        }
      }
    } catch (err) {
      console.warn(`[SCRIP-MASTER] Startup auto-recovery attempt ${attempt} — could not fetch broker configs: ${err}`);
      scheduleStartupScripSyncRetry(storage, attempt + 1);
    }
  }, delayMs);
}

/**
 * Schedules a background retry for the scrip master sync with linear backoff
 * (same pattern as the Translation Layer auto-recovery). Backoff: 5s × attempt,
 * capped at 60 s. Idempotent per broker — a second call while a timer is already
 * pending is silently dropped.
 */
export function scheduleScripSyncRetry(
  storage: IStorage,
  brokerConfig: BrokerConfig,
  attempt: number,
): void {
  const brokerId = String(brokerConfig.id);
  if (retryTimers.has(brokerId)) return;

  const delayMs = Math.min(5000 * attempt, 60_000);
  console.warn(
    `[SCRIP-MASTER] Auto-recovery: scheduling retry attempt ${attempt} for broker ${brokerConfig.ucc || brokerId} in ${delayMs / 1000}s`,
  );

  scripRecoveryState.set(brokerId, { isRecovering: true, recoveryAttempt: attempt });

  const timer = setTimeout(async () => {
    retryTimers.delete(brokerId);
    try {
      const result = await runScripMasterSync(storage, brokerConfig);
      if (result.success) {
        scripRecoveryState.set(brokerId, { isRecovering: false, recoveryAttempt: 0 });
        console.log(
          `[SCRIP-MASTER] Auto-recovery: recovered after ${attempt} attempt(s) — ${result.synced} contracts loaded`,
        );
        await calculatePlanMargins(storage, brokerConfig).catch(err =>
          console.warn(`[SCRIP-MASTER] Capital margin calc error (retry recovery): ${err}`)
        );
      } else {
        console.warn(`[SCRIP-MASTER] Auto-recovery: attempt ${attempt} failed: ${result.error}`);
        scheduleScripSyncRetry(storage, brokerConfig, attempt + 1);
      }
    } catch (err) {
      console.warn(`[SCRIP-MASTER] Auto-recovery: attempt ${attempt} threw: ${err}`);
      scheduleScripSyncRetry(storage, brokerConfig, attempt + 1);
    }
  }, delayMs);

  retryTimers.set(brokerId, timer);
}

export async function rescheduleScripMasterSync(storage: IStorage): Promise<void> {
  const wasScheduled = syncTimeoutHandle !== null || syncIntervalHandle !== null;
  if (syncTimeoutHandle !== null) { clearTimeout(syncTimeoutHandle); syncTimeoutHandle = null; }
  if (syncIntervalHandle !== null) { clearInterval(syncIntervalHandle); syncIntervalHandle = null; }

  const syncClockSetting = await storage.getSetting("scrip_master_sync_time");
  const syncClockStr = syncClockSetting?.value || "09:10";
  const [syncHH, syncMM] = syncClockStr.split(":").map(Number);

  const nowIST = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  const targetIST = new Date(nowIST);
  targetIST.setUTCHours(syncHH - 5, syncMM - 30, 0, 0);
  if (targetIST.getTime() <= Date.now()) targetIST.setUTCDate(targetIST.getUTCDate() + 1);
  const msUntil = targetIST.getTime() - Date.now();

  const verb = wasScheduled ? "Rescheduled" : "Scheduled";
  console.log(`[SCRIP-MASTER] ${verb} daily sync to ${syncClockStr} IST (in ${Math.round(msUntil / 60000)} min)`);

  syncTimeoutHandle = setTimeout(async () => {
    syncTimeoutHandle = null;
    try {
      const allBrokerConfigs = await storage.getBrokerConfigs();
      const liveBrokers = allBrokerConfigs.filter(bc => bc.isConnected && bc.brokerName === "kotak_neo");
      if (liveBrokers.length === 0) {
        console.log(`[SCRIP-MASTER] Scheduled sync at ${syncClockStr} IST — no connected Kotak brokers, skipping`);
      } else {
        // Phase A: download CSV once via primary (or first) connected broker
        const primaryBroker = liveBrokers.find(bc => bc.isPrimary) || liveBrokers[0];
        try {
          const result = await runScripMasterSync(storage, primaryBroker);
          if (result.success) {
            console.log(`[SCRIP-MASTER] Daily sync Phase A (${syncClockStr} IST): ${result.synced} contracts via ${primaryBroker.ucc || primaryBroker.id}`);
            await calculatePlanMargins(storage, primaryBroker).catch(err =>
              console.warn(`[SCRIP-MASTER] Capital margin calc error (daily Phase A): ${err}`)
            );
          } else {
            console.warn(`[SCRIP-MASTER] Daily sync Phase A failed: ${result.error} — scheduling auto-recovery`);
            scheduleScripSyncRetry(storage, primaryBroker, 1);
          }
        } catch (err) {
          console.warn(`[SCRIP-MASTER] Daily sync Phase A threw: ${err} — scheduling auto-recovery`);
          scheduleScripSyncRetry(storage, primaryBroker, 1);
        }
        // Phase B: calculate margins for remaining brokers
        const otherBrokers = liveBrokers.filter(bc => bc.id !== primaryBroker.id);
        if (otherBrokers.length > 0) {
          await runScripMasterSyncPhaseB(storage, otherBrokers).catch(err =>
            console.warn(`[SCRIP-MASTER] Daily sync Phase B error: ${err}`)
          );
          for (const bc of otherBrokers) {
            await calculatePlanMargins(storage, bc).catch(err =>
              console.warn(`[SCRIP-MASTER] Capital margin calc error (daily Phase B, ${bc.ucc}): ${err}`)
            );
          }
        }
      }
    } catch (err) {
      console.log(`[SCRIP-MASTER] Scheduled sync error: ${err}`);
    }
    syncIntervalHandle = setInterval(async () => {
      try {
        const allBrokerConfigs = await storage.getBrokerConfigs();
        const liveBrokers = allBrokerConfigs.filter(bc => bc.isConnected && bc.brokerName === "kotak_neo");
        if (liveBrokers.length === 0) return;
        const primaryBroker = liveBrokers.find(bc => bc.isPrimary) || liveBrokers[0];
        try {
          const result = await runScripMasterSync(storage, primaryBroker);
          if (result.success) {
            console.log(`[SCRIP-MASTER] Daily sync Phase A (interval): ${result.synced} contracts via ${primaryBroker.ucc || primaryBroker.id}`);
            await calculatePlanMargins(storage, primaryBroker).catch(err =>
              console.warn(`[SCRIP-MASTER] Capital margin calc error (daily interval Phase A): ${err}`)
            );
          } else {
            console.warn(`[SCRIP-MASTER] Daily sync Phase A (interval) failed: ${result.error} — scheduling auto-recovery`);
            scheduleScripSyncRetry(storage, primaryBroker, 1);
          }
        } catch (err) {
          console.warn(`[SCRIP-MASTER] Daily sync Phase A (interval) threw: ${err} — scheduling auto-recovery`);
          scheduleScripSyncRetry(storage, primaryBroker, 1);
        }
        const otherBrokers = liveBrokers.filter(bc => bc.id !== primaryBroker.id);
        if (otherBrokers.length > 0) {
          await runScripMasterSyncPhaseB(storage, otherBrokers).catch(err =>
            console.warn(`[SCRIP-MASTER] Daily sync Phase B (interval) error: ${err}`)
          );
          for (const bc of otherBrokers) {
            await calculatePlanMargins(storage, bc).catch(err =>
              console.warn(`[SCRIP-MASTER] Capital margin calc error (daily interval Phase B, ${bc.ucc}): ${err}`)
            );
          }
        }
      } catch (err) {
        console.log(`[SCRIP-MASTER] Scheduled sync error: ${err}`);
      }
    }, 24 * 60 * 60 * 1000);
  }, msUntil);
}
