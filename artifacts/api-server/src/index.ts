import { createServer } from "http";
import path from "path";
import express from "express";
import app, { log } from "./app";
import { storage } from "./storage";
import { registerRoutes } from "./routes";
import { tradingCache } from "./cache";
import TL from "./tl-kotak-neo-v3";
import EL from "./el-kotak-neo-v3";
import { ensureBrokerEndpoints } from "./seed-broker-el";
import { runScripMasterSync, loadScripMasterFromDisk, runScripMasterSyncPhaseB } from "./smc-kotak-neo-v3";
import { startCapitalManager, calculatePlanMargins } from "./cm-kotak-neo-v3";
import { rescheduleScripMasterSync, scheduleScripSyncRetry, scheduleStartupScripSyncRetry, startIntradayScripRefresh } from "./scrip-sync-scheduler";
import { startPlanMonitor } from "./plan-monitor";
import { startDataRetentionJob } from "./data-retention";
import { resolveAllSignalsFromActionMapper, processTradeSignal, startPersistentExit, startPersistentRollback, closeTradeById } from "./te-kotak-neo-v3";
import { startMarketDataManager } from "./md-kotak-neo-v3";
import { startWsGateway } from "./hsm-kotak-neo-v3";
import { startHsiGateway } from "./hsi-kotak-neo-v3";
import { startSettlementEngine } from "./se-kotak-neo-v3";
import { startTslEngine } from "./tsl-kotak-neo-v3";
import { startMtmMonitor } from "./mtm-monitor";
import { seedMarketCalendarDefaults } from "./market-calendar";
import { db } from "./db";
import { sql } from "drizzle-orm";
import { setupAuth, registerAuthRoutes } from "./replit_integrations/auth";

process.on("uncaughtException", (err) => {
  console.error("UNCAUGHT EXCEPTION:", (err as any).stack || (err as any).message || err);
});
process.on("unhandledRejection", (reason) => {
  console.error("UNHANDLED REJECTION:", reason);
});

const httpServer = createServer(app);

async function recoverUnprocessedSignals(): Promise<void> {
  const CUTOFF_MS = 90_000;
  const now = Date.now();

  const unprocessed = await storage.getUnprocessedWebhookData();
  const recent = unprocessed.filter((row: any) => {
    const receivedAt = row.receivedAt ? new Date(row.receivedAt).getTime() : 0;
    return now - receivedAt <= CUTOFF_MS;
  });

  if (recent.length === 0) {
    log(`[RECOVERY] No recent unprocessed signals (cutoff: ${CUTOFF_MS / 1000}s)`);
    return;
  }

  log(`[RECOVERY] Found ${recent.length} unprocessed signal(s) within ${CUTOFF_MS / 1000}s cutoff — replaying...`);

  for (const row of recent) {
    try {
      const configs = await storage.getStrategyConfigsByWebhookId((row as any).webhookId);
      if (configs.length === 0) {
        log(`[RECOVERY] No MC configs for webhook ${(row as any).webhookId} — skipping signal ${(row as any).id.slice(0, 8)}`);
        await storage.updateWebhookData((row as any).id, { processStatus: "skipped" });
        continue;
      }

      const signalData: Record<string, any> = { ...row, signalType: (row as any).signalType, alert: (row as any).alert };

      for (const config of configs) {
        const resolvedSignals = resolveAllSignalsFromActionMapper(signalData, (config as any).actionMapper);
        for (const resolved of resolvedSignals) {
          if ((resolved as any).signalType === "hold") continue;
          await processTradeSignal(storage, row as any, (config as any).id, {
            blockType: (resolved as any).blockType,
            resolvedAction: (resolved as any).resolvedAction,
          }).catch((err: any) => log(`[RECOVERY] processTradeSignal error for config ${(config as any).id.slice(0, 8)}: ${err}`));
        }
      }

      await storage.updateWebhookData((row as any).id, { processStatus: "processed" });
      log(`[RECOVERY] Signal ${(row as any).id.slice(0, 8)} replayed successfully`);
    } catch (err) {
      log(`[RECOVERY] Error replaying signal ${(row as any).id.slice(0, 8)}: ${err}`);
      await storage.updateWebhookData((row as any).id, { processStatus: "failed" }).catch(() => {});
    }
  }
}

function gracefulShutdown(signal: string) {
  console.error(`${signal} received, shutting down gracefully...`);
  httpServer.close(() => {
    console.error("HTTP server closed");
    process.exit(0);
  });
  setTimeout(() => {
    console.error("Forced shutdown after timeout");
    process.exit(1);
  }, 3000);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("exit", (code) => console.error(`Process exit with code: ${code}`));

app.get("/api/health", (_req, res) => {
  res.status(200).json({ status: "ok", timestamp: Date.now() });
});

(async () => {
  await setupAuth(app);
  registerAuthRoutes(app);

  await registerRoutes(httpServer, app);

  app.use("/api/kotak-test", express.static(path.join(__dirname, "../public/kotak-test"), { index: "demo.html" }));

  async function waitForDatabase() {
    console.log(`[BOOT] Probing database connection (waking up serverless DB)...`);
    for (let i = 1; i <= 30; i++) {
      try {
        await db.execute(sql`SELECT 1`);
        console.log(`[BOOT] Database is awake and ready! (Took ~${i * 2}s)`);
        return;
      } catch (error: any) {
        console.warn(`[BOOT] DB probe failed, retrying in 2s... (Attempt ${i}/30)`);
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }
    console.warn(`[BOOT] DB warmup probe timed out after 60 seconds. Proceeding with boot sequence...`);
  }
  await waitForDatabase();

  try {
    const ufResult = await storage.ensureUniversalFields();
    if ((ufResult as any).inserted > 0) {
      log(`Initialized ${(ufResult as any).inserted} universal fields in database`);
    } else {
      log(`Universal fields already populated (${(ufResult as any).existing})`);
    }
  } catch (err) {
    log(`Universal fields initialization warning: ${err}`);
  }

  try {
    await TL.init();
  } catch (err) {
    log(`Translation Layer initialization warning: ${err}`);
  }

  try {
    await ensureBrokerEndpoints();
    await EL.init();
  } catch (err) {
    log(`Execution Layer initialization warning: ${err}`);
  }

  tradingCache.warmUp(storage).catch((err: any) => log(`Cache warm-up error: ${err}`));

  storage.backfillUniqueCodes().catch((err: any) => log(`[BACKFILL] Error: ${err}`));

  setTimeout(() => {
    recoverUnprocessedSignals().catch((err: any) => log(`[RECOVERY] Error: ${err}`));
  }, 3000);

  try {
    const diskResult = await loadScripMasterFromDisk(storage);
    if ((diskResult as any).success) {
      log(`[STARTUP] Scrip master disk load: ${(diskResult as any).synced} instruments loaded (cache pre-warmed)`);
    } else {
      log(`[STARTUP] Scrip master disk load: ${(diskResult as any).error} — will sync from network`);
    }
  } catch (err) {
    log(`[STARTUP] Scrip master disk load warning: ${err}`);
  }

  try {
    const allBrokerConfigs = await storage.getBrokerConfigs();
    const liveBrokers = allBrokerConfigs.filter(
      (bc: any) => bc.isConnected === true && bc.brokerName === "kotak_neo"
    );
    if (liveBrokers.length > 0) {
      const primaryBroker = liveBrokers.find((bc: any) => bc.isPrimary) || liveBrokers[0];
      try {
        const result = await runScripMasterSync(storage, primaryBroker);
        if ((result as any).success) {
          log(`[STARTUP] Scrip master Phase A: ${(result as any).synced} contracts via ${primaryBroker.ucc || primaryBroker.id}`);
          calculatePlanMargins(storage, primaryBroker, { skipPrimaryGuard: true }).catch((err: any) =>
            log(`[STARTUP] Capital margin calc error: ${err}`)
          );
        } else {
          log(`[STARTUP] Scrip master Phase A warning: ${(result as any).error} — scheduling auto-recovery`);
          scheduleScripSyncRetry(storage, primaryBroker, 1);
        }
      } catch (syncErr) {
        log(`[STARTUP] Scrip master Phase A warning: ${syncErr} — scheduling auto-recovery`);
        scheduleScripSyncRetry(storage, primaryBroker, 1);
      }
      const otherBrokers = liveBrokers.filter((bc: any) => bc.id !== primaryBroker.id);
      if (otherBrokers.length > 0) {
        runScripMasterSyncPhaseB(storage, otherBrokers).catch((err: any) =>
          log(`[STARTUP] Scrip master Phase B warning: ${err}`)
        );
      }
    }
  } catch (err) {
    log(`[STARTUP] Scrip master auto-sync warning: ${err} — scheduling auto-recovery`);
    scheduleStartupScripSyncRetry(storage, 1);
  }

  try {
    await startCapitalManager(storage);
    log(`Capital Manager started`);
  } catch (err) {
    log(`Capital Manager startup warning: ${err}`);
  }

  try {
    startPlanMonitor(storage);
    log(`Plan monitor started`);
  } catch (err) {
    log(`Plan monitor startup warning: ${err}`);
  }

  try {
    await seedMarketCalendarDefaults(storage);
  } catch (err) {
    log(`[STARTUP] Market calendar seed warning: ${err}`);
  }

  try {
    const existingRollback = await storage.getSetting("rollback_api_retry_count");
    if (!existingRollback) await storage.setSetting("rollback_api_retry_count", "5");
    const existingSyncClock = await storage.getSetting("scrip_master_sync_time");
    if (!existingSyncClock) await storage.setSetting("scrip_master_sync_time", "09:10");
    const existingIntradayInterval = await storage.getSetting("scrip_master_intraday_interval_mins");
    if (!existingIntradayInterval) await storage.setSetting("scrip_master_intraday_interval_mins", "0");
    const existingMaxClose = await storage.getSetting("max_close_retry_count");
    if (!existingMaxClose) await storage.setSetting("max_close_retry_count", "0");
    const existingHalted = await storage.getSetting("trading_halted");
    if (!existingHalted) await storage.setSetting("trading_halted", "false");
    const existingUccConcurrency = await storage.getSetting("te_ucc_concurrency");
    if (!existingUccConcurrency) await storage.setSetting("te_ucc_concurrency", "50");
    const existingIntradayCapital = await storage.getSetting("cm_intraday_refresh_mins");
    if (!existingIntradayCapital) await storage.setSetting("cm_intraday_refresh_mins", "5");
    const existingAutoPauseThreshold = await storage.getSetting("auto_pause_skip_threshold");
    if (!existingAutoPauseThreshold) await storage.setSetting("auto_pause_skip_threshold", "3");
    const existingMarginCalcTime = await storage.getSetting("margin_calc_time");
    if (!existingMarginCalcTime) await storage.setSetting("margin_calc_time", "09:12");
    const existingFitCheckTime = await storage.getSetting("fit_check_time");
    if (!existingFitCheckTime) await storage.setSetting("fit_check_time", "09:15");
    const existingFillRetryCount = await storage.getSetting("fill_price_rest_retry_count");
    if (!existingFillRetryCount) await storage.setSetting("fill_price_rest_retry_count", "3");
    const existingFillRetryDelay = await storage.getSetting("fill_price_rest_retry_delay_ms");
    if (!existingFillRetryDelay) await storage.setSetting("fill_price_rest_retry_delay_ms", "2000");
  } catch (err) {
    log(`[STARTUP] Default settings seed warning: ${err}`);
  }

  try {
    const KNOWN_INDICES = [
      { indexName: "BANKEX", exchange: "BFO" },
      { indexName: "BANKNIFTY", exchange: "NFO" },
      { indexName: "FINNIFTY", exchange: "NFO" },
      { indexName: "MIDCPNIFTY", exchange: "NFO" },
      { indexName: "NIFTY", exchange: "NFO" },
      { indexName: "SENSEX", exchange: "BFO" },
    ];
    const existingRows = await storage.getAllIndexMarginSettings();
    const existingNames = new Set(existingRows.map((r: any) => r.indexName));
    const seededIdx: string[] = [];
    for (const idx of KNOWN_INDICES) {
      if (!existingNames.has(idx.indexName)) {
        await storage.upsertIndexMarginSetting({
          indexName: idx.indexName,
          exchange: idx.exchange,
          exposureRate: "2.0",
          spanRate: "10.0",
          expiryMultiplier: "1.25",
          updatedAt: null,
        });
        seededIdx.push(idx.indexName);
      }
    }
    if (seededIdx.length > 0) log(`[STARTUP] Index margin settings seeded: ${seededIdx.join(", ")}`);
    else log(`[STARTUP] Index margin settings: all ${KNOWN_INDICES.length} indices already present`);
  } catch (err) {
    log(`[STARTUP] Index margin settings seed warning: ${err}`);
  }

  try {
    const CANONICAL_ERROR_ROUTES = [
      { errorPattern: "instrument has been expired", actionType: "terminal_close", description: "Kotak RMS: expired contract — exact string" },
      { errorPattern: "order type is invalid", actionType: "terminal_close", description: "Kotak RMS: invalid contract type" },
      { errorPattern: "1007", actionType: "terminal_close", description: "Kotak API V3 code: Invalid Symbol" },
      { errorPattern: "invalid symbol", actionType: "terminal_close", description: "Kotak: symbol not found in scrip master" },
      { errorPattern: "scrip not found", actionType: "terminal_close", description: "Kotak: scrip lookup failure" },
      { errorPattern: "1009", actionType: "terminal_close", description: "Kotak API V3 code: Invalid Quantity" },
      { errorPattern: "invalid quantity", actionType: "terminal_close", description: "Kotak: lot/quantity mismatch" },
      { errorPattern: "1006", actionType: "terminal_close", description: "Kotak API V3 code: Invalid Exchange" },
      { errorPattern: "insufficient holding", actionType: "terminal_close", description: "Kotak RMS: position already gone from account" },
      { errorPattern: "insufficient balance", actionType: "terminal_close", description: "Kotak RMS: funds exhausted — cannot close" },
      { errorPattern: "no open position", actionType: "terminal_close", description: "Broker has no record of this open position" },
      { errorPattern: "delisted", actionType: "terminal_close", description: "Instrument has been delisted" },
      { errorPattern: "suspended", actionType: "terminal_close", description: "Instrument is suspended from trading" },
      { errorPattern: "401", actionType: "system_halt", description: "Kotak Auth: Unauthorized — session expired or invalid token" },
      { errorPattern: "expired session", actionType: "system_halt", description: "Kotak Auth: Session has expired — re-login required" },
      { errorPattern: "invalid totp", actionType: "system_halt", description: "Kotak Auth: TOTP rejected — re-authentication required" },
      { errorPattern: "invalid mpin", actionType: "system_halt", description: "Kotak Auth: MPIN rejected — re-authentication required" },
      { errorPattern: "unauthorized", actionType: "system_halt", description: "Kotak: IP not whitelisted or session expired — SEBI IP whitelist mandate" },
      { errorPattern: "token not found", actionType: "terminal_close", description: "Internal guard: token missing from Scrip Master (expired contract)" },
      { errorPattern: "quote fetch failed", actionType: "terminal_close", description: "Internal guard: options live quote API failure" },
    ];
    let seeded = 0;
    for (const route of CANONICAL_ERROR_ROUTES) {
      try {
        const inserted = await storage.upsertErrorRoute(route);
        if (inserted) seeded++;
      } catch (err) {
        log(`[STARTUP] Error routing seed failed for "${route.errorPattern}": ${err}`);
      }
    }
    if (seeded > 0) log(`[STARTUP] Error routing: ${seeded} new pattern(s) seeded.`);
    else log(`[STARTUP] Error routing: all ${CANONICAL_ERROR_ROUTES.length} patterns already present.`);
  } catch (err) {
    log(`[STARTUP] Error routing seed warning: ${err}`);
  }

  try {
    await rescheduleScripMasterSync(storage);
  } catch (err) {
    log(`[SCRIP-MASTER] Daily sync scheduler startup warning: ${err}`);
  }

  try {
    startIntradayScripRefresh(storage);
    log(`[SCRIP-MASTER] Intraday refresh scheduler started`);
  } catch (err) {
    log(`[SCRIP-MASTER] Intraday refresh scheduler startup warning: ${err}`);
  }

  try {
    startDataRetentionJob(storage);
  } catch (err) {
    log(`Data retention job startup warning: ${err}`);
  }

  try {
    startMarketDataManager();
    log(`Market Data Manager started`);
  } catch (err) {
    log(`Market Data Manager startup warning: ${err}`);
  }

  try {
    startSettlementEngine(storage);
    log(`Settlement Engine started`);
  } catch (err) {
    log(`Settlement Engine startup warning: ${err}`);
  }

  try {
    await startTslEngine(storage, closeTradeById);
    log(`TSL Engine started`);
  } catch (err) {
    log(`TSL Engine startup warning (non-fatal): ${err}`);
  }

  try {
    startMtmMonitor(storage);
    log(`MTM Monitor started`);
  } catch (err) {
    log(`MTM Monitor startup warning (non-fatal): ${err}`);
  }

  try {
    await startWsGateway(storage);
    log(`WS Gateway started`);
  } catch (err) {
    log(`WS Gateway startup warning (non-fatal): ${err}`);
  }

  try {
    await startHsiGateway(storage);
    log(`HSI Gateway started`);
  } catch (err) {
    log(`HSI Gateway startup warning (non-fatal): ${err}`);
  }

  setTimeout(async () => {
    try {
      const allBrokerConfigs = await storage.getBrokerConfigs();
      const liveBrokers = allBrokerConfigs.filter((bc: any) => bc.isConnected === true && bc.brokerName === "kotak_neo");
      if (liveBrokers.length === 0) return;
      const brokerConfig = liveBrokers[0];

      const stalledTrades = await storage.getTradesByStatuses(["close_failed", "rollback_failed", "rolling_back"]);
      if (stalledTrades.length === 0) return;

      log(`[RECOVERY] Found ${stalledTrades.length} stalled trade(s) — re-igniting persistent retry loops...`);

      const closeFailedMap = new Map<string, string>();
      for (const t of stalledTrades.filter((t: any) => t.status === "close_failed")) {
        const key = `${(t as any).planId}:${(t as any).blockType}`;
        if (!closeFailedMap.has(key) && (t as any).blockType) {
          closeFailedMap.set(key, (t as any).planId);
          startPersistentExit(storage, (t as any).planId, (t as any).blockType, brokerConfig);
          log(`[RECOVERY] Re-ignited PersistentExit for plan ${(t as any).planId.slice(0, 8)} block ${(t as any).blockType}`);
        }
      }

      const rollbackPlanIds = new Set<string>();
      for (const t of stalledTrades.filter((t: any) => t.status === "rollback_failed" || t.status === "rolling_back")) {
        if (!rollbackPlanIds.has((t as any).planId)) {
          rollbackPlanIds.add((t as any).planId);
          startPersistentRollback(storage, (t as any).planId, brokerConfig);
          log(`[RECOVERY] Re-ignited PersistentRollback for plan ${(t as any).planId.slice(0, 8)}`);
        }
      }
    } catch (err) {
      log(`[RECOVERY] Reboot amnesia catcher error: ${err}`);
    }
  }, 5000);

  setInterval(async () => {
    if (!EL.isReady()) {
      log(`[EL] Health check: EL not ready, triggering background recovery...`);
      try {
        await EL.reload();
        if (EL.isReady()) {
          log(`[EL] Health check: recovery successful`);
        } else {
          log(`[EL] Health check: recovery failed, will retry in 60s`);
        }
      } catch (err) {
        log(`[EL] Health check: recovery error: ${err}`);
      }
    }
  }, 60_000);

  app.use((err: any, _req: any, res: any, next: any) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    console.error("Internal Server Error:", err);
    if (res.headersSent) {
      return next(err);
    }
    return res.status(status).json({ message });
  });

  const port = parseInt(process.env.PORT || "5000", 10);
  let retries = 0;
  const maxRetries = 3;

  function startListening() {
    httpServer.listen({ port, host: "0.0.0.0" }, () => {
      log(`serving on port ${port}`);
      setInterval(() => log("heartbeat"), 30000);
    });
  }

  httpServer.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE" && retries < maxRetries) {
      retries++;
      log(`Port ${port} in use, retrying in 1s... (attempt ${retries}/${maxRetries})`);
      setTimeout(startListening, 1000);
    } else {
      console.error("Fatal server error:", err);
      process.exit(1);
    }
  });

  startListening();
})();
