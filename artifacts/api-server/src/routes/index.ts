import type { Express } from "express";
import type { Server } from "http";
import { storage } from "../storage";
import { registerWebhookRoutes } from "./webhook-routes";
import { registerStrategyRoutes } from "./strategy-routes";
import { registerBrokerRoutes } from "./broker-routes";
import { registerFieldMappingRoutes } from "./field-mapping-routes";
import { registerUniversalFieldRoutes } from "./universal-field-routes";
import { registerAdminRoutes } from "./admin-routes";
import { registerSseRoutes } from "./sse-routes";
import { registerMarketCalendarRoutes } from "./market-calendar-routes";
import { registerIndexMarginRoutes } from "./index-margin-routes";
import healthRouter from "./health";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  app.use("/api", healthRouter);
  registerSseRoutes(app);
  registerAdminRoutes(app, storage);
  registerStrategyRoutes(app, storage);
  registerWebhookRoutes(app, storage);
  registerBrokerRoutes(app, storage);
  registerFieldMappingRoutes(app, storage);
  registerUniversalFieldRoutes(app, storage);
  registerMarketCalendarRoutes(app, storage);
  registerIndexMarginRoutes(app, storage);

  return httpServer;
}
