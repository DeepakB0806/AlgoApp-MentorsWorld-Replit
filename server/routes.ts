import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertStrategySchema, insertWebhookSchema, insertBrokerConfigSchema } from "@shared/schema";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  
  // Strategies Routes
  app.get("/api/strategies", async (req, res) => {
    try {
      const strategies = await storage.getStrategies();
      res.json(strategies);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch strategies" });
    }
  });

  app.get("/api/strategies/:id", async (req, res) => {
    try {
      const strategy = await storage.getStrategy(req.params.id);
      if (!strategy) {
        return res.status(404).json({ error: "Strategy not found" });
      }
      res.json(strategy);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch strategy" });
    }
  });

  app.post("/api/strategies", async (req, res) => {
    try {
      const parsed = insertStrategySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid strategy data", details: parsed.error });
      }
      const strategy = await storage.createStrategy(parsed.data);
      res.status(201).json(strategy);
    } catch (error) {
      res.status(500).json({ error: "Failed to create strategy" });
    }
  });

  app.patch("/api/strategies/:id", async (req, res) => {
    try {
      const parsed = insertStrategySchema.partial().safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid strategy data", details: parsed.error });
      }
      const strategy = await storage.updateStrategy(req.params.id, parsed.data);
      if (!strategy) {
        return res.status(404).json({ error: "Strategy not found" });
      }
      res.json(strategy);
    } catch (error) {
      res.status(500).json({ error: "Failed to update strategy" });
    }
  });

  app.delete("/api/strategies/:id", async (req, res) => {
    try {
      const deleted = await storage.deleteStrategy(req.params.id);
      if (!deleted) {
        return res.status(404).json({ error: "Strategy not found" });
      }
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete strategy" });
    }
  });

  // Webhooks Routes
  app.get("/api/webhooks", async (req, res) => {
    try {
      const webhooks = await storage.getWebhooks();
      res.json(webhooks);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch webhooks" });
    }
  });

  app.get("/api/webhooks/:id", async (req, res) => {
    try {
      const webhook = await storage.getWebhook(req.params.id);
      if (!webhook) {
        return res.status(404).json({ error: "Webhook not found" });
      }
      res.json(webhook);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch webhook" });
    }
  });

  app.post("/api/webhooks", async (req, res) => {
    try {
      const parsed = insertWebhookSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid webhook data", details: parsed.error });
      }
      const webhook = await storage.createWebhook(parsed.data);
      res.status(201).json(webhook);
    } catch (error) {
      res.status(500).json({ error: "Failed to create webhook" });
    }
  });

  app.patch("/api/webhooks/:id", async (req, res) => {
    try {
      const parsed = insertWebhookSchema.partial().safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid webhook data", details: parsed.error });
      }
      const webhook = await storage.updateWebhook(req.params.id, parsed.data);
      if (!webhook) {
        return res.status(404).json({ error: "Webhook not found" });
      }
      res.json(webhook);
    } catch (error) {
      res.status(500).json({ error: "Failed to update webhook" });
    }
  });

  app.delete("/api/webhooks/:id", async (req, res) => {
    try {
      const deleted = await storage.deleteWebhook(req.params.id);
      if (!deleted) {
        return res.status(404).json({ error: "Webhook not found" });
      }
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete webhook" });
    }
  });

  // Webhook Logs Routes
  app.get("/api/webhook-logs", async (req, res) => {
    try {
      const logs = await storage.getWebhookLogs();
      res.json(logs);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch webhook logs" });
    }
  });

  // Broker Config Routes
  app.get("/api/broker-configs", async (req, res) => {
    try {
      const configs = await storage.getBrokerConfigs();
      res.json(configs);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch broker configs" });
    }
  });

  app.get("/api/broker-configs/:id", async (req, res) => {
    try {
      const config = await storage.getBrokerConfig(req.params.id);
      if (!config) {
        return res.status(404).json({ error: "Broker config not found" });
      }
      res.json(config);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch broker config" });
    }
  });

  app.post("/api/broker-configs", async (req, res) => {
    try {
      const parsed = insertBrokerConfigSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid broker config data", details: parsed.error });
      }
      const config = await storage.createBrokerConfig(parsed.data);
      res.status(201).json(config);
    } catch (error) {
      res.status(500).json({ error: "Failed to create broker config" });
    }
  });

  app.patch("/api/broker-configs/:id", async (req, res) => {
    try {
      const parsed = insertBrokerConfigSchema.partial().safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid broker config data", details: parsed.error });
      }
      const config = await storage.updateBrokerConfig(req.params.id, parsed.data);
      if (!config) {
        return res.status(404).json({ error: "Broker config not found" });
      }
      res.json(config);
    } catch (error) {
      res.status(500).json({ error: "Failed to update broker config" });
    }
  });

  app.delete("/api/broker-configs/:id", async (req, res) => {
    try {
      const deleted = await storage.deleteBrokerConfig(req.params.id);
      if (!deleted) {
        return res.status(404).json({ error: "Broker config not found" });
      }
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete broker config" });
    }
  });

  app.post("/api/broker-configs/:id/test", async (req, res) => {
    try {
      const config = await storage.getBrokerConfig(req.params.id);
      if (!config) {
        return res.status(404).json({ error: "Broker config not found" });
      }
      // Simulate connection test
      const updated = await storage.updateBrokerConfig(req.params.id, {
        isConnected: true,
        lastConnected: new Date().toISOString().replace('T', ' ').slice(0, 19),
      });
      res.json({ success: true, config: updated });
    } catch (error) {
      res.status(500).json({ error: "Connection test failed" });
    }
  });

  // Trading Data Routes (mock data)
  app.get("/api/positions", async (req, res) => {
    try {
      const positions = await storage.getPositions();
      res.json(positions);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch positions" });
    }
  });

  app.get("/api/orders", async (req, res) => {
    try {
      const orders = await storage.getOrders();
      res.json(orders);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch orders" });
    }
  });

  app.get("/api/holdings", async (req, res) => {
    try {
      const holdings = await storage.getHoldings();
      res.json(holdings);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch holdings" });
    }
  });

  app.get("/api/portfolio-summary", async (req, res) => {
    try {
      const summary = await storage.getPortfolioSummary();
      res.json(summary);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch portfolio summary" });
    }
  });

  return httpServer;
}
