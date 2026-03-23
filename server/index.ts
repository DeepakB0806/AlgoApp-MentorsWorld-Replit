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
import { startPlanMonitor } from "./plan-monitor";
import { startDataRetentionJob } from "./data-retention";
import { resolveAllSignalsFromActionMapper, processTradeSignal, startPersistentExit, startPersistentRollback } from "./te-kotak-neo-v3";

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
          log(`[STARTUP] Scrip master auto-sync warning for broker ${brokerConfig.ucc || brokerConfig.id}: ${result.error}`);
        }
      } catch (syncErr) {
        log(`[STARTUP] Scrip master auto-sync warning for broker ${brokerConfig.ucc || brokerConfig.id}: ${syncErr}`);
      }
    }
  } catch (err) {
    log(`[STARTUP] Scrip master auto-sync warning: ${err}`);
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
  } catch (err) {
    log(`[STARTUP] Default settings seed warning: ${err}`);
  }

  // Start scheduled data retention job — prunes old rows from all major tables daily
  try {
    startDataRetentionJob(storage);
  } catch (err) {
    log(`Data retention job startup warning: ${err}`);
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
