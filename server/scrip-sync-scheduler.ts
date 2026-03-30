import type { IStorage } from "./storage";
import { runScripMasterSync } from "./smc-kotak-neo-v3";

// Module-level handles so any call to rescheduleScripMasterSync cancels the
// previous timer/interval before setting a new one. This allows the Settings UI
// to update the sync clock without a server restart.
let syncTimeoutHandle: ReturnType<typeof setTimeout> | null = null;
let syncIntervalHandle: ReturnType<typeof setInterval> | null = null;

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
          const result = await runScripMasterSync(storage, bc);
          console.log(`[SCRIP-MASTER] Scheduled daily sync (${syncClockStr} IST): ${result.success ? `${result.synced} contracts loaded` : result.error}`);
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
          const result = await runScripMasterSync(storage, bc);
          console.log(`[SCRIP-MASTER] Scheduled daily sync (${syncClockStr} IST): ${result.success ? `${result.synced} contracts loaded` : result.error}`);
        }
      } catch (err) {
        console.log(`[SCRIP-MASTER] Scheduled sync error: ${err}`);
      }
    }, 24 * 60 * 60 * 1000);
  }, msUntil);
}
