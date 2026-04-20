import type { IStorage } from "./storage";
import { runScripMasterSync } from "./smc-kotak-neo-v3";
import type { BrokerConfig } from "@shared/schema";

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

  const timer = setTimeout(async () => {
    retryTimers.delete(brokerId);
    try {
      const result = await runScripMasterSync(storage, brokerConfig);
      if (result.success) {
        console.log(
          `[SCRIP-MASTER] Auto-recovery: recovered after ${attempt} attempt(s) — ${result.synced} contracts loaded`,
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
        for (const bc of liveBrokers) {
          try {
            const result = await runScripMasterSync(storage, bc);
            if (result.success) {
              console.log(`[SCRIP-MASTER] Scheduled daily sync (${syncClockStr} IST): ${result.synced} contracts loaded`);
            } else {
              console.warn(`[SCRIP-MASTER] Scheduled daily sync failed: ${result.error} — scheduling auto-recovery`);
              scheduleScripSyncRetry(storage, bc, 1);
            }
          } catch (err) {
            console.warn(`[SCRIP-MASTER] Scheduled daily sync threw: ${err} — scheduling auto-recovery`);
            scheduleScripSyncRetry(storage, bc, 1);
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
        for (const bc of liveBrokers) {
          try {
            const result = await runScripMasterSync(storage, bc);
            if (result.success) {
              console.log(`[SCRIP-MASTER] Scheduled daily sync (${syncClockStr} IST): ${result.synced} contracts loaded`);
            } else {
              console.warn(`[SCRIP-MASTER] Scheduled daily sync failed: ${result.error} — scheduling auto-recovery`);
              scheduleScripSyncRetry(storage, bc, 1);
            }
          } catch (err) {
            console.warn(`[SCRIP-MASTER] Scheduled daily sync threw: ${err} — scheduling auto-recovery`);
            scheduleScripSyncRetry(storage, bc, 1);
          }
        }
      } catch (err) {
        console.log(`[SCRIP-MASTER] Scheduled sync error: ${err}`);
      }
    }, 24 * 60 * 60 * 1000);
  }, msUntil);
}
