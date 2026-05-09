import type { Express } from "express";
import { addSseClient, broadcast, getClientCount } from "../sse-hub";

let intradayRefreshInterval: ReturnType<typeof setInterval> | null = null;
let keepaliveInterval: ReturnType<typeof setInterval> | null = null;

export function registerSseRoutes(app: Express): void {
  app.get("/api/sse/feed", (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    addSseClient(res);

    res.write(`event: ping\ndata: ${JSON.stringify({ t: Date.now(), clients: getClientCount() })}\n\n`);
  });

  if (!intradayRefreshInterval) {
    intradayRefreshInterval = setInterval(() => {
      if (getClientCount() > 0) {
        broadcast("refresh", { t: Date.now() });
      }
    }, 15_000);
  }

  if (!keepaliveInterval) {
    keepaliveInterval = setInterval(() => {
      if (getClientCount() > 0) {
        broadcast("ping", { t: Date.now() });
      }
    }, 30_000);
  }
}
