import type { Express } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { registerWebhookRoutes } from "./routes/webhook-routes";
import { registerStrategyRoutes } from "./routes/strategy-routes";
import { registerBrokerRoutes } from "./routes/broker-routes";
import { registerFieldMappingRoutes } from "./routes/field-mapping-routes";
import { registerUniversalFieldRoutes } from "./routes/universal-field-routes";
import { registerAdminRoutes } from "./routes/admin-routes";
import { registerSseRoutes } from "./routes/sse-routes";
import { registerMarketCalendarRoutes } from "./routes/market-calendar-routes";
import { registerIndexMarginRoutes } from "./routes/index-margin-routes";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
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
