import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { setupAuth, registerAuthRoutes } from "./replit_integrations/auth";
import cookieParser from "cookie-parser";
import { storage } from "./storage";
import { tradingCache } from "./cache";
import TL from "./tl-kotak-neo-v3";
import EL from "./el-kotak-neo-v3";
import { ensureBrokerEndpoints } from "./seed-broker-el";
import { runScripMasterSync } from "./smc-kotak-neo-v3";
import { rescheduleScripMasterSync, scheduleScripSyncRetry, scheduleStartupScripSyncRetry } from "./scrip-sync-scheduler";
import { startPlanMonitor } from "./plan-monitor";
import { startDataRetentionJob } from "./data-retention";
import { resolveAllSignalsFromActionMapper, processTradeSignal, startPersistentExit, startPersistentRollback, closeTradeById } from "./te-kotak-neo-v3";
import { startMarketDataManager } from "./md-kotak-neo-v3";
import { startWsGateway } from "./hsm-kotak-neo-v3";
import { startHsiGateway } from "./hsi-kotak-neo-v3";
import { startSettlementEngine } from "./se-kotak-neo-v3";
import { startTslEngine } from "./tsl-kotak-neo-v3";

process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err.stack || err.message || err);
});
process.on('unhandledRejection', (reason) => {
  console.error('UNHANDLED REJECTION:', reason);
});

const app = express();
const httpServer = createServer(app);

async function recoverUnprocessedSignals(): Promise<void> {
  const CUTOFF_MS = 90_000;
  const now = Date.now();

  const unprocessed = await storage.getUnprocessedWebhookData();
  const recent = unprocessed.filter(row => {
    const receivedAt = row.receivedAt ? new Date(row.receivedAt).getTime() : 0;
    return (now - receivedAt) <= CUTOFF_MS;
  });

  if (recent.length === 0) {
    log(`[RECOVERY] No recent unprocessed signals (cutoff: ${CUTOFF_MS / 1000}s)`);
    return;
  }

  log(`[RECOVERY] Found ${recent.length} unprocessed signal(s) within ${CUTOFF_MS / 1000}s cutoff — replaying...`);

  for (const row of recent) {
    try {
      const configs = await storage.getStrategyConfigsByWebhookId(row.webhookId);
      if (configs.length === 0) {
        log(`[RECOVERY] No MC configs for webhook ${row.webhookId} — skipping signal ${row.id.slice(0, 8)}`);
        await storage.updateWebhookData(row.id, { processStatus: "skipped" });
        continue;
      }

      const signalData: Record<string, any> = { ...row, signalType: row.signalType, alert: row.alert };

      for (const config of configs) {
        const resolvedSignals = resolveAllSignalsFromActionMapper(signalData, config.actionMapper);
        for (const resolved of resolvedSignals) {
          if (resolved.signalType === "hold") continue;
          await processTradeSignal(storage, row, config.id, {
            blockType: resolved.blockType,
            resolvedAction: resolved.resolvedAction,
          }).catch(err => log(`[RECOVERY] processTradeSignal error for config ${config.id.slice(0, 8)}: ${err}`));
        }
      }

      await storage.updateWebhookData(row.id, { processStatus: "processed" });
      log(`[RECOVERY] Signal ${row.id.slice(0, 8)} replayed successfully`);
    } catch (err) {
      log(`[RECOVERY] Error replaying signal ${row.id.slice(0, 8)}: ${err}`);
      await storage.updateWebhookData(row.id, { processStatus: "failed" }).catch(() => {});
    }
  }
}

function gracefulShutdown(signal: string) {
  console.error(`${signal} received, shutting down gracefully...`);
  httpServer.close(() => {
    console.error('HTTP server closed');
    process.exit(0);
  });
  setTimeout(() => {
    console.error('Forced shutdown after timeout');
    process.exit(1);
  }, 3000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('exit', (code) => console.error(`Process exit with code: ${code}`));

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(cookieParser());

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

app.get("/api/health", (_req, res) => {
  res.status(200).json({ status: "ok", timestamp: Date.now() });
});

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedSnippet: string | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    try {
      if (Array.isArray(bodyJson)) {
        capturedSnippet = `[Array(${bodyJson.length})]`;
      } else if (bodyJson && typeof bodyJson === 'object') {
        const keys = Object.keys(bodyJson).slice(0, 5).join(',');
        capturedSnippet = `{${keys}}`;
      } else {
        capturedSnippet = String(bodyJson).substring(0, 200);
      }
    } catch { capturedSnippet = '[response]'; }
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedSnippet) {
        logLine += ` :: ${capturedSnippet}`;
      }
      log(logLine);
    }
  });

  next();
});

(async () => {
  // Setup authentication BEFORE other routes
  await setupAuth(app);
  registerAuthRoutes(app);
  
  await registerRoutes(httpServer, app);

  try {
    const ufResult = await storage.ensureUniversalFields();
    if (ufResult.inserted > 0) {
      log(`Initialized ${ufResult.inserted} universal fields in database`);
    } else {
      log(`Universal fields already populated (${ufResult.existing})`);
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

  tradingCache.warmUp(storage).catch(err => log(`Cache warm-up error: ${err}`));

  // Backfill unique codes for any MC/TPS rows that were created before codes were added
  storage.backfillUniqueCodes().catch(err => log(`[BACKFILL] Error: ${err}`));

  // Crash recovery: replay any signals that arrived during a server outage (90-second cutoff)
  setTimeout(() => {
    recoverUnprocessedSignals().catch(err => log(`[RECOVERY] Error: ${err}`));
  }, 3000);

  // Auto-sync scrip master for connected live brokers on startup
  try {
    const allBrokerConfigs = await storage.getBrokerConfigs();
    const liveBrokers = allBrokerConfigs.filter(
      (bc) => bc.isConnected === true && bc.brokerName === "kotak_neo"
    );
    for (const brokerConfig of liveBrokers) {
      try {
        const result = await runScripMasterSync(storage, brokerConfig);
        if (result.success) {
          log(`[STARTUP] Scrip master auto-sync: ${result.synced} contracts loaded for broker ${brokerConfig.ucc || brokerConfig.id}`);
        } else {
          log(`[STARTUP] Scrip master auto-sync warning for broker ${brokerConfig.ucc || brokerConfig.id}: ${result.error} — scheduling auto-recovery`);
          scheduleScripSyncRetry(storage, brokerConfig, 1);
        }
      } catch (syncErr) {
        log(`[STARTUP] Scrip master auto-sync warning for broker ${brokerConfig.ucc || brokerConfig.id}: ${syncErr} — scheduling auto-recovery`);
        scheduleScripSyncRetry(storage, brokerConfig, 1);
      }
    }
  } catch (err) {
    log(`[STARTUP] Scrip master auto-sync warning: ${err} — scheduling auto-recovery`);
    scheduleStartupScripSyncRetry(storage, 1);
  }

  // Start plan monitor — auto square-off based on exitTime and exitOnExpiry
  try {
    startPlanMonitor(storage);
    log(`Plan monitor started`);
  } catch (err) {
    log(`Plan monitor startup warning: ${err}`);
  }

  // Seed default settings (only writes if key is absent)
  try {
    const existingRollback = await storage.getSetting("rollback_api_retry_count");
    if (!existingRollback) await storage.setSetting("rollback_api_retry_count", "5");
    const existingSyncClock = await storage.getSetting("scrip_master_sync_time");
    if (!existingSyncClock) await storage.setSetting("scrip_master_sync_time", "09:10");
    const existingMaxClose = await storage.getSetting("max_close_retry_count");
    if (!existingMaxClose) await storage.setSetting("max_close_retry_count", "0");
    const existingHalted = await storage.getSetting("trading_halted");
    if (!existingHalted) await storage.setSetting("trading_halted", "false");
  } catch (err) {
    log(`[STARTUP] Default settings seed warning: ${err}`);
  }

  // Seed default error routing rules — idempotent upsert on every startup
  try {
    const CANONICAL_ERROR_ROUTES = [
      { errorPattern: "instrument has been expired",  actionType: "terminal_close", description: "Kotak RMS: expired contract — exact string" },
      { errorPattern: "order type is invalid",        actionType: "terminal_close", description: "Kotak RMS: invalid contract type" },
      { errorPattern: "1007",                         actionType: "terminal_close", description: "Kotak API V3 code: Invalid Symbol" },
      { errorPattern: "invalid symbol",               actionType: "terminal_close", description: "Kotak: symbol not found in scrip master" },
      { errorPattern: "scrip not found",              actionType: "terminal_close", description: "Kotak: scrip lookup failure" },
      { errorPattern: "1009",                         actionType: "terminal_close", description: "Kotak API V3 code: Invalid Quantity" },
      { errorPattern: "invalid quantity",             actionType: "terminal_close", description: "Kotak: lot/quantity mismatch" },
      { errorPattern: "1006",                         actionType: "terminal_close", description: "Kotak API V3 code: Invalid Exchange" },
      { errorPattern: "insufficient holding",         actionType: "terminal_close", description: "Kotak RMS: position already gone from account" },
      { errorPattern: "insufficient balance",         actionType: "terminal_close", description: "Kotak RMS: funds exhausted — cannot close" },
      { errorPattern: "no open position",             actionType: "terminal_close", description: "Broker has no record of this open position" },
      { errorPattern: "delisted",                     actionType: "terminal_close", description: "Instrument has been delisted" },
      { errorPattern: "suspended",                    actionType: "terminal_close", description: "Instrument is suspended from trading" },
      { errorPattern: "401",                          actionType: "system_halt",    description: "Kotak Auth: Unauthorized — session expired or invalid token" },
      { errorPattern: "expired session",              actionType: "system_halt",    description: "Kotak Auth: Session has expired — re-login required" },
      { errorPattern: "invalid totp",                 actionType: "system_halt",    description: "Kotak Auth: TOTP rejected — re-authentication required" },
      { errorPattern: "invalid mpin",                 actionType: "system_halt",    description: "Kotak Auth: MPIN rejected — re-authentication required" },
      { errorPattern: "unauthorized",                 actionType: "system_halt",    description: "Kotak: IP not whitelisted or session expired — SEBI IP whitelist mandate" },
      { errorPattern: "token not found",              actionType: "terminal_close", description: "Internal guard: token missing from Scrip Master (expired contract)" },
      { errorPattern: "quote fetch failed",           actionType: "terminal_close", description: "Internal guard: options live quote API failure" },
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

  // Daily scrip master scheduled sync — fires at the user-configured IST time (default 09:10)
  try {
    await rescheduleScripMasterSync(storage);
  } catch (err) {
    log(`[SCRIP-MASTER] Daily sync scheduler startup warning: ${err}`);
  }

  // Start scheduled data retention job — prunes old rows from all major tables daily
  try {
    startDataRetentionJob(storage);
  } catch (err) {
    log(`Data retention job startup warning: ${err}`);
  }

  // Start Market Data Manager (subscribe() delegates to HSM via lazy require — no wiring needed)
  try {
    startMarketDataManager();
    log(`Market Data Manager started`);
  } catch (err) {
    log(`Market Data Manager startup warning: ${err}`);
  }

  // Start Settlement Engine — 10s sweep to aggregate P&L into strategyDailyPnl
  try {
    startSettlementEngine(storage);
    log(`Settlement Engine started`);
  } catch (err) {
    log(`Settlement Engine startup warning: ${err}`);
  }

  // Start TSL Engine — rehydrates active trails, starts 15s dirty flush loop
  // Must start before WS Gateway so processTick() is ready before first tick arrives
  try {
    await startTslEngine(storage, closeTradeById);
    log(`TSL Engine started`);
  } catch (err) {
    log(`TSL Engine startup warning (non-fatal): ${err}`);
  }

  // Start WebSocket Gateway — subscribes open NRML trades, non-fatal on failure
  try {
    await startWsGateway(storage);
    log(`WS Gateway started`);
  } catch (err) {
    log(`WS Gateway startup warning (non-fatal): ${err}`);
  }

  // Start HSI Gateway — real-time order status stream via Bangalore relay
  try {
    await startHsiGateway(storage);
    log(`HSI Gateway started`);
  } catch (err) {
    log(`HSI Gateway startup warning (non-fatal): ${err}`);
  }

  // FIX 4b: Reboot Amnesia Catcher — re-ignite persistent retry loops for any
  // trades left in a failed/in-progress state from before the server restarted.
  setTimeout(async () => {
    try {
      const allBrokerConfigs = await storage.getBrokerConfigs();
      const liveBrokers = allBrokerConfigs.filter(bc => bc.isConnected === true && bc.brokerName === "kotak_neo");
      if (liveBrokers.length === 0) return;
      const brokerConfig = liveBrokers[0];

      const stalledTrades = await storage.getTradesByStatuses(["close_failed", "rollback_failed", "rolling_back"]);
      if (stalledTrades.length === 0) return;

      log(`[RECOVERY] Found ${stalledTrades.length} stalled trade(s) — re-igniting persistent retry loops...`);

      // Group close_failed by planId + blockType → re-fire startPersistentExit
      const closeFailedMap = new Map<string, string>();
      for (const t of stalledTrades.filter(t => t.status === "close_failed")) {
        const key = `${t.planId}:${t.blockType}`;
        if (!closeFailedMap.has(key) && t.blockType) {
          closeFailedMap.set(key, t.planId);
          startPersistentExit(storage, t.planId, t.blockType, brokerConfig);
          log(`[RECOVERY] Re-ignited PersistentExit for plan ${t.planId.slice(0, 8)} block ${t.blockType}`);
        }
      }

      // Group rollback_failed/rolling_back by planId → re-fire startPersistentRollback
      const rollbackPlanIds = new Set<string>();
      for (const t of stalledTrades.filter(t => t.status === "rollback_failed" || t.status === "rolling_back")) {
        if (!rollbackPlanIds.has(t.planId)) {
          rollbackPlanIds.add(t.planId);
          startPersistentRollback(storage, t.planId, brokerConfig);
          log(`[RECOVERY] Re-ignited PersistentRollback for plan ${t.planId.slice(0, 8)}`);
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

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  const port = parseInt(process.env.PORT || "5000", 10);
  let retries = 0;
  const maxRetries = 3;

  function startListening() {
    httpServer.listen({ port, host: "0.0.0.0" }, () => {
      log(`serving on port ${port}`);
      setInterval(() => log('heartbeat'), 30000);
    });
  }

  httpServer.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE' && retries < maxRetries) {
      retries++;
      log(`Port ${port} in use, retrying in 1s (attempt ${retries}/${maxRetries})...`);
      setTimeout(startListening, 1000);
    } else {
      console.error(`Server error: ${err.message}`);
      process.exit(1);
    }
  });

  startListening();
})();
