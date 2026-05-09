import fs from "fs";
import path from "path";
import type { IStorage } from "./storage";

// ─── Default Retention Windows ───────────────────────────────────────────────
// These are the out-of-the-box values. Each one has a matching setting key
// in the app_settings table so the user can override via the Settings page.
const DEFAULTS: Record<string, number> = {
  retention_webhook_data_days:        90,
  retention_strategy_trades_days:    365,
  retention_broker_session_logs_days: 30,
  retention_broker_test_logs_days:     7,
  retention_webhook_status_logs_days: 30,
  retention_process_flow_logs_days:   30,
};

const SCRIP_MASTER_RETENTION_DAYS = 2;
const SCRIP_MASTER_PATTERN = /^scrip_master_[a-z]+_(\d{4}-\d{2}-\d{2})\.csv$/i;

async function readSettings(storage: IStorage): Promise<Record<string, number>> {
  const values: Record<string, number> = {};
  for (const [key, def] of Object.entries(DEFAULTS)) {
    try {
      const s = await storage.getSetting(key);
      const parsed = s ? parseInt(s.value, 10) : NaN;
      values[key] = Number.isFinite(parsed) && parsed > 0 ? parsed : def;
    } catch {
      values[key] = def;
    }
  }
  return values;
}

async function seedDefaultSettings(storage: IStorage) {
  for (const [key, value] of Object.entries(DEFAULTS)) {
    try {
      const existing = await storage.getSetting(key);
      if (!existing) {
        await storage.setSetting(key, String(value));
      }
    } catch {}
  }
}

function pruneOldScripMasterFiles(): void {
  const log = (msg: string) => console.log(`[DATA-RETENTION] ${msg}`);
  try {
    const rootDir = process.cwd();
    const files = fs.readdirSync(rootDir);

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - (SCRIP_MASTER_RETENTION_DAYS - 1));
    cutoff.setHours(0, 0, 0, 0);

    let pruned = 0;
    for (const file of files) {
      const match = file.match(SCRIP_MASTER_PATTERN);
      if (!match) continue;
      const fileDate = new Date(match[1]);
      if (isNaN(fileDate.getTime())) continue;
      if (fileDate < cutoff) {
        try {
          fs.unlinkSync(path.join(rootDir, file));
          pruned++;
        } catch (err) {
          log(`Warning: could not delete ${file}: ${err}`);
        }
      }
    }

    if (pruned > 0) {
      log(`Pruned ${pruned} old scrip master file(s) (keep last ${SCRIP_MASTER_RETENTION_DAYS}d)`);
    } else {
      log("Scrip master files — nothing to prune");
    }
  } catch (err) {
    log(`Scrip master file pruning error: ${err}`);
  }
}

async function runRetentionCleanup(storage: IStorage) {
  const log = (msg: string) => console.log(`[DATA-RETENTION] ${msg}`);

  try {
    const s = await readSettings(storage);

    const jobs: Array<{ name: string; fn: () => Promise<number> }> = [
      { name: "webhook_data",          fn: () => storage.deleteWebhookDataOlderThan(s.retention_webhook_data_days) },
      { name: "strategy_trades",       fn: () => storage.deleteStrategyTradesOlderThan(s.retention_strategy_trades_days) },
      { name: "broker_session_logs",   fn: () => storage.deleteBrokerSessionLogsOlderThan(s.retention_broker_session_logs_days) },
      { name: "broker_test_logs",      fn: () => storage.deleteBrokerTestLogsOlderThan(s.retention_broker_test_logs_days) },
      { name: "webhook_status_logs",   fn: () => storage.deleteOldLogsGlobally(s.retention_webhook_status_logs_days) },
      { name: "process_flow_logs",     fn: () => storage.deleteProcessFlowLogsOlderThan(s.retention_process_flow_logs_days) },
    ];

    const results = await Promise.allSettled(jobs.map((j) => j.fn()));

    let anyDeleted = false;
    results.forEach((r, i) => {
      if (r.status === "fulfilled") {
        if (r.value > 0) {
          const days = s[`retention_${jobs[i].name}_days`] ?? "?";
          log(`Pruned ${r.value} rows from ${jobs[i].name} (keep last ${days}d)`);
          anyDeleted = true;
        }
      } else {
        log(`Warning for ${jobs[i].name}: ${r.reason}`);
      }
    });

    if (!anyDeleted) {
      log("Nothing to prune — all tables within retention windows");
    }
  } catch (err) {
    console.error("[DATA-RETENTION] Cleanup error:", err);
  }

  pruneOldScripMasterFiles();
}

export function startDataRetentionJob(storage: IStorage) {
  const DAILY_MS = 24 * 60 * 60 * 1000;
  const STARTUP_DELAY_MS = 30_000;

  seedDefaultSettings(storage).catch((err) =>
    console.error("[DATA-RETENTION] Settings seed error:", err)
  );

  pruneOldScripMasterFiles();

  setTimeout(() => runRetentionCleanup(storage), STARTUP_DELAY_MS);
  setInterval(() => runRetentionCleanup(storage), DAILY_MS);

  console.log(`[DATA-RETENTION] Daily job scheduled (first run in ${STARTUP_DELAY_MS / 1000}s)`);
}
