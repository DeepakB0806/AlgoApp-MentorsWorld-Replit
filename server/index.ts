import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { setupAuth, registerAuthRoutes } from "./replit_integrations/auth";
import cookieParser from "cookie-parser";
import { storage } from "./storage";
import { tradingCache } from "./cache";

process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err.stack || err.message || err);
});
process.on('unhandledRejection', (reason) => {
  console.error('UNHANDLED REJECTION:', reason);
});

const app = express();
const httpServer = createServer(app);

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

  tradingCache.warmUp(storage).catch(err => log(`Cache warm-up error: ${err}`));

  // Auto-cleanup old webhook logs (older than 30 days) on startup
  try {
    const deletedCount = await storage.deleteOldLogsGlobally(30);
    if (deletedCount > 0) {
      log(`Auto-cleanup: Removed ${deletedCount} webhook logs older than 30 days`);
    }
  } catch (error) {
    log(`Auto-cleanup warning: ${error}`);
  }

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
