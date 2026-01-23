import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertStrategySchema, insertWebhookSchema, insertBrokerConfigSchema } from "@shared/schema";

// Helper to parse numeric values, handling empty strings and nulls
function parseNumeric(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const num = typeof value === "number" ? value : parseFloat(String(value));
  return isNaN(num) ? undefined : num;
}
import { 
  testKotakNeoConnectivity, 
  authenticateKotakNeo,
  getPositions as getKotakPositions,
  getOrderBook as getKotakOrders,
  getHoldings as getKotakHoldings,
  getLimits as getKotakLimits,
  type KotakNeoSession
} from "./kotak-neo-api";

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
      
      // Get domain setting to determine webhook URL
      const domainSetting = await storage.getSetting("domain_name");
      
      // Create webhook with proper URL
      const webhook = await storage.createWebhook(parsed.data);
      
      // Generate the proper webhook URL based on domain setting
      const generatedUrl = domainSetting?.value 
        ? `https://${domainSetting.value}/api/webhook/${webhook.id}`
        : `/api/webhook/${webhook.id}`;
      
      // Update with the correct URL
      const updatedWebhook = await storage.updateWebhook(webhook.id, { webhookUrl: generatedUrl });
      res.status(201).json(updatedWebhook || webhook);
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

  // Configure webhook fields from comma-separated list
  app.post("/api/webhooks/:id/configure-fields", async (req, res) => {
    try {
      const { fields } = req.body;
      
      if (!fields || !Array.isArray(fields)) {
        return res.status(400).json({ error: "Fields array is required" });
      }
      
      // Convert field names to WebhookFieldConfig array
      const fieldConfig = fields.map((name: string, index: number) => ({
        name: name.trim(),
        key: name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''),
        type: 'text' as const,
        order: index
      }));
      
      // Update webhook with field configuration
      const webhook = await storage.updateWebhook(req.params.id, {
        fieldConfig: JSON.stringify(fieldConfig)
      });
      
      if (!webhook) {
        return res.status(404).json({ error: "Webhook not found" });
      }
      
      res.json({ success: true, fieldConfig, webhook });
    } catch (error) {
      console.error("Error configuring webhook fields:", error);
      res.status(500).json({ error: "Failed to configure webhook fields" });
    }
  });

  // Get default 19-field configuration for TradingView
  app.get("/api/webhooks/default-fields", async (req, res) => {
    const defaultFields = [
      { name: "Time Unix", key: "time_unix", type: "timestamp", order: 0 },
      { name: "Exchange", key: "exchange", type: "text", order: 1 },
      { name: "Ticker (Indices)", key: "indices", type: "text", order: 2 },
      { name: "Indicator", key: "indicator", type: "text", order: 3 },
      { name: "Action (Alert)", key: "alert", type: "text", order: 4 },
      { name: "Price", key: "price", type: "number", order: 5 },
      { name: "Local Time", key: "local_time", type: "text", order: 6 },
      { name: "Mode", key: "mode", type: "text", order: 7 },
      { name: "Mode Desc", key: "mode_desc", type: "text", order: 8 },
      { name: "Fast Line", key: "first_line", type: "number", order: 9 },
      { name: "Mid Line", key: "mid_line", type: "number", order: 10 },
      { name: "Slow Line", key: "slow_line", type: "number", order: 11 },
      { name: "Supertrend (ST)", key: "st", type: "number", order: 12 },
      { name: "Half Trend (HT)", key: "ht", type: "number", order: 13 },
      { name: "RSI", key: "rsi", type: "number", order: 14 },
      { name: "RSI Scaled", key: "rsi_scaled", type: "number", order: 15 },
      { name: "Alert System", key: "alert_system", type: "text", order: 16 },
      { name: "Action Binary", key: "action_binary", type: "number", order: 17 },
      { name: "Lock State", key: "lock_state", type: "text", order: 18 }
    ];
    res.json(defaultFields);
  });

  // Webhook Registry - for super admin and team access
  // Get all webhook registry entries (historical data)
  app.get("/api/webhook-registry", async (req, res) => {
    try {
      const registry = await storage.getWebhookRegistry();
      res.json(registry);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch webhook registry" });
    }
  });

  // Lookup webhook by unique code from registry
  app.get("/api/webhook-registry/:code", async (req, res) => {
    try {
      const entry = await storage.getWebhookRegistryEntry(req.params.code);
      if (!entry) {
        return res.status(404).json({ error: "Webhook code not found in registry" });
      }
      res.json(entry);
    } catch (error) {
      res.status(500).json({ error: "Failed to lookup webhook code" });
    }
  });

  // Webhook Receiver Endpoint - receives TradingView alerts
  app.post("/api/webhook/:id", async (req, res) => {
    const startTime = Date.now();
    const webhookId = req.params.id;
    
    try {
      // Find the webhook configuration
      const webhook = await storage.getWebhook(webhookId);
      if (!webhook) {
        return res.status(404).json({ error: "Webhook not found" });
      }

      if (!webhook.isActive) {
        return res.status(403).json({ error: "Webhook is disabled" });
      }

      // Verify secret key if configured
      const providedSecret = req.headers["x-secret-key"] || req.query.secret;
      if (webhook.secretKey && providedSecret !== webhook.secretKey) {
        return res.status(401).json({ error: "Invalid secret key" });
      }

      // Parse the payload (TradingView alert data)
      const payload = req.body;
      console.log("Webhook received:", webhookId, JSON.stringify(payload));

      // Get request metadata
      const ipAddress = (req.headers["x-forwarded-for"] as string)?.split(",")[0] || req.socket.remoteAddress || null;
      const userAgent = req.headers["user-agent"] || null;

      // Extract TradingView fields
      const logData = {
        webhookId,
        timestamp: new Date().toISOString(),
        payload: JSON.stringify(payload),
        status: "success" as const,
        response: "Alert received and processed",
        executionTime: 0,
        ipAddress,
        userAgent,
        // 1. TIME AS PER UNIX (TIMESTAMP)
        timeUnix: parseNumeric(payload.time_unix ?? payload.timeUnix ?? payload.TIME_UNIX ?? payload.timestamp ?? payload.TIMESTAMP),
        // 2. EXCHANGE
        exchange: payload.exchange || payload.EXCHANGE,
        // 3. TICKER (INDICES)
        indices: payload.indices || payload.INDICES || payload.ticker || payload.TICKER,
        // 4. INDICATOR
        indicator: payload.indicator || payload.INDICATOR,
        // 5. ACTION (ALERT)
        alert: payload.alert || payload.ALERT || payload.action || payload.ACTION,
        // 6. PRICE
        price: parseNumeric(payload.price ?? payload.PRICE),
        // 7. LOCAL TIME
        localTime: payload.local_time || payload.localTime || payload.LOCAL_TIME,
        // 8. MODE
        mode: payload.mode || payload.MODE,
        // 9. MODE DESC
        modeDesc: payload.mode_desc || payload.modeDesc || payload.MODE_DESC,
        // 10. FAST LINE (FIRST LINE)
        firstLine: parseNumeric(payload.first_line ?? payload.fast_line ?? payload.FIRST_LINE ?? payload.FAST_LINE ?? payload.firstLine ?? payload.fastLine),
        // 11. MID LINE
        midLine: parseNumeric(payload.mid_line ?? payload.MID_LINE ?? payload.midLine),
        // 12. SLOW LINE
        slowLine: parseNumeric(payload.slow_line ?? payload.SLOW_LINE ?? payload.slowLine),
        // 13. SUPERTREND (ST)
        st: parseNumeric(payload.st ?? payload.ST ?? payload.supertrend ?? payload.SUPERTREND),
        // 14. HALF TREND (HT)
        ht: parseNumeric(payload.ht ?? payload.HT ?? payload.halftrend ?? payload.HALFTREND ?? payload.half_trend ?? payload.HALF_TREND),
        // 15. RSI
        rsi: parseNumeric(payload.rsi ?? payload.RSI),
        // 16. RSI SCALED
        rsiScaled: parseNumeric(payload.rsi_scaled ?? payload.RSI_SCALED ?? payload.rsiScaled),
        // 17. ALERT SYSTEM
        alertSystem: payload.alert_system || payload.alertSystem || payload.ALERT_SYSTEM,
        // 18. ACTION BINARY (ACTION TYPE)
        actionBinary: parseNumeric(payload.action_binary ?? payload.ACTION_BINARY ?? payload.actionBinary ?? payload.action_type ?? payload.ACTION_TYPE),
        // 19. LOCK STATE
        lockState: payload.lock_state || payload.lockState || payload.LOCK_STATE,
      };

      // Log the webhook call
      logData.executionTime = Date.now() - startTime;
      await storage.createWebhookLog(logData);

      // Store webhook data for strategy access
      const signalType = logData.actionBinary === 1 ? "buy" : logData.actionBinary === 0 ? "sell" : "hold";
      await storage.createWebhookData({
        webhookId,
        strategyId: webhook.strategyId || undefined,
        webhookName: webhook.name,
        receivedAt: new Date().toISOString(),
        rawPayload: JSON.stringify(payload),
        timeUnix: logData.timeUnix,
        exchange: logData.exchange,
        indices: logData.indices,
        indicator: logData.indicator,
        alert: logData.alert,
        price: logData.price,
        localTime: logData.localTime,
        mode: logData.mode,
        modeDesc: logData.modeDesc,
        firstLine: logData.firstLine,
        midLine: logData.midLine,
        slowLine: logData.slowLine,
        st: logData.st,
        ht: logData.ht,
        rsi: logData.rsi,
        rsiScaled: logData.rsiScaled,
        alertSystem: logData.alertSystem,
        actionBinary: logData.actionBinary,
        lockState: logData.lockState,
        signalType,
        isProcessed: false,
      });

      // Update webhook trigger count
      await storage.updateWebhook(webhookId, {
        lastTriggered: new Date().toISOString(),
        totalTriggers: (webhook.totalTriggers || 0) + 1,
      });

      res.json({ 
        success: true, 
        message: "Webhook processed successfully",
        action: logData.actionBinary === 1 ? "BUY" : logData.actionBinary === 0 ? "SELL" : "UNKNOWN",
        signal: signalType,
      });
    } catch (error) {
      console.error("Webhook processing error:", error);
      
      // Log the failed webhook
      await storage.createWebhookLog({
        webhookId,
        timestamp: new Date().toISOString(),
        payload: JSON.stringify(req.body),
        status: "failed",
        response: String(error),
        executionTime: Date.now() - startTime,
      });

      res.status(500).json({ error: "Webhook processing failed" });
    }
  });

  // Webhook Status Logs
  app.get("/api/webhooks/:id/status-logs", async (req, res) => {
    try {
      const logs = await storage.getWebhookStatusLogs(req.params.id);
      res.json(logs);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch status logs" });
    }
  });

  // Webhook Log Statistics
  app.get("/api/webhooks/:id/stats", async (req, res) => {
    try {
      const stats = await storage.getWebhookLogStats(req.params.id);
      res.json(stats);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch webhook stats" });
    }
  });

  // Delete old logs (cleanup)
  app.delete("/api/webhooks/:id/logs/cleanup", async (req, res) => {
    try {
      const daysToKeep = parseInt(req.query.days as string) || 30;
      const deletedCount = await storage.deleteOldWebhookLogs(req.params.id, daysToKeep);
      res.json({ success: true, deletedCount, daysToKeep });
    } catch (error) {
      res.status(500).json({ error: "Failed to cleanup logs" });
    }
  });

  // Webhook Data - stored JSON data for strategy access
  app.get("/api/webhook-data", async (req, res) => {
    try {
      const data = await storage.getWebhookData();
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch webhook data" });
    }
  });

  app.get("/api/webhook-data/webhook/:webhookId", async (req, res) => {
    try {
      const webhookId = req.params.webhookId;
      
      // Check if this webhook is linked to another webhook
      const webhook = await storage.getWebhook(webhookId);
      const effectiveWebhookId = webhook?.linkedWebhookId || webhookId;
      
      const data = await storage.getWebhookDataByWebhook(effectiveWebhookId);
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch webhook data" });
    }
  });

  // Link webhook to production webhook data stream by unique code
  app.post("/api/webhooks/:id/link", async (req, res) => {
    try {
      const { uniqueCode } = req.body;
      
      if (!uniqueCode) {
        return res.status(400).json({ error: "uniqueCode is required" });
      }
      
      // Find the production webhook by its unique code
      const productionWebhook = await storage.getWebhookByUniqueCode(uniqueCode);
      if (!productionWebhook) {
        return res.status(404).json({ error: "No webhook found with that code" });
      }
      
      // Link to the production webhook's ID
      const webhook = await storage.updateWebhook(req.params.id, { linkedWebhookId: productionWebhook.id });
      if (!webhook) {
        return res.status(404).json({ error: "Webhook not found" });
      }
      
      res.json({ success: true, webhook, linkedWebhook: productionWebhook });
    } catch (error) {
      res.status(500).json({ error: "Failed to link webhook" });
    }
  });

  // Unlink webhook from production data stream
  app.delete("/api/webhooks/:id/link", async (req, res) => {
    try {
      const webhook = await storage.updateWebhook(req.params.id, { linkedWebhookId: null });
      if (!webhook) {
        return res.status(404).json({ error: "Webhook not found" });
      }
      
      res.json({ success: true, webhook });
    } catch (error) {
      res.status(500).json({ error: "Failed to unlink webhook" });
    }
  });

  app.get("/api/webhook-data/strategy/:strategyId", async (req, res) => {
    try {
      const data = await storage.getWebhookDataByStrategy(req.params.strategyId);
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch webhook data" });
    }
  });

  app.get("/api/webhook-data/webhook/:webhookId/latest", async (req, res) => {
    try {
      const data = await storage.getLatestWebhookData(req.params.webhookId);
      if (!data) {
        return res.status(404).json({ error: "No data found for this webhook" });
      }
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch webhook data" });
    }
  });

  app.patch("/api/webhook-data/:id/processed", async (req, res) => {
    try {
      const data = await storage.markWebhookDataProcessed(req.params.id);
      if (!data) {
        return res.status(404).json({ error: "Webhook data not found" });
      }
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: "Failed to update webhook data" });
    }
  });

  // Test Webhook
  app.post("/api/webhooks/:id/test", async (req, res) => {
    const startTime = Date.now();
    const webhookId = req.params.id;
    
    try {
      const webhook = await storage.getWebhook(webhookId);
      if (!webhook) {
        return res.status(404).json({ error: "Webhook not found" });
      }

      // Create test payload
      const testPayload = {
        time_unix: Math.floor(Date.now() / 1000),
        exchange: "NSE",
        indices: "NIFTY50",
        indicator: "Test Indicator",
        alert: "Test Alert",
        price: 19500.50,
        local_time: new Date().toLocaleString(),
        mode: "test",
        mode_desc: "Test mode",
        action_binary: 1,
        lock_state: "unlocked",
      };

      const responseTime = Date.now() - startTime;
      
      // Log the test
      await storage.createWebhookStatusLog({
        webhookId,
        testPayload: JSON.stringify(testPayload),
        status: "success",
        statusCode: 200,
        responseMessage: "Test webhook executed successfully",
        responseTime,
        testedAt: new Date().toISOString(),
      });

      res.json({ 
        success: true, 
        message: "Test webhook sent successfully",
        testPayload,
        responseTime,
      });
    } catch (error) {
      console.error("Test webhook error:", error);
      const responseTime = Date.now() - startTime;
      
      await storage.createWebhookStatusLog({
        webhookId,
        testPayload: JSON.stringify(req.body || {}),
        status: "failed",
        statusCode: 500,
        responseMessage: "Test failed",
        errorMessage: String(error),
        responseTime,
        testedAt: new Date().toISOString(),
      });

      res.status(500).json({ error: "Test webhook failed" });
    }
  });

  // App Settings Routes
  app.get("/api/settings/:key", async (req, res) => {
    try {
      const setting = await storage.getSetting(req.params.key);
      res.json(setting || { key: req.params.key, value: null });
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch setting" });
    }
  });

  app.post("/api/settings/:key", async (req, res) => {
    try {
      const { value } = req.body;
      if (typeof value !== "string") {
        return res.status(400).json({ error: "Value must be a string" });
      }
      const setting = await storage.setSetting(req.params.key, value);
      res.json(setting);
    } catch (error) {
      res.status(500).json({ error: "Failed to save setting" });
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

      const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

      if (config.brokerName === "kotak_neo") {
        if (!config.consumerKey) {
          return res.status(400).json({ 
            success: false, 
            error: "Consumer Key (API Token) is required for Kotak Neo" 
          });
        }

        const result = await testKotakNeoConnectivity(config.consumerKey);
        
        const updated = await storage.updateBrokerConfig(req.params.id, {
          isConnected: result.success,
          lastConnected: result.success ? now : config.lastConnected,
          connectionError: result.success ? null : result.error,
          lastTestTime: now,
          lastTestResult: result.success ? "success" : "failed",
          lastTestMessage: result.message || result.error || null,
          totalTests: (config.totalTests || 0) + 1,
          successfulTests: result.success ? (config.successfulTests || 0) + 1 : (config.successfulTests || 0),
          updatedAt: now,
        });

        return res.json({ 
          success: result.success, 
          message: result.message,
          error: result.error,
          config: updated 
        });
      }

      const updated = await storage.updateBrokerConfig(req.params.id, {
        isConnected: false,
        connectionError: "Broker not yet supported for live connectivity test",
        lastTestTime: now,
        lastTestResult: "failed",
        lastTestMessage: "Broker not yet supported",
        totalTests: (config.totalTests || 0) + 1,
        updatedAt: now,
      });
      res.json({ success: false, message: "Broker not yet supported", config: updated });
    } catch (error) {
      res.status(500).json({ error: "Connection test failed", details: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  app.post("/api/broker-configs/:id/authenticate", async (req, res) => {
    try {
      const config = await storage.getBrokerConfig(req.params.id);
      if (!config) {
        return res.status(404).json({ error: "Broker config not found" });
      }

      const { totp } = req.body;
      const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
      
      if (config.brokerName !== "kotak_neo") {
        return res.status(400).json({ error: "Authentication only supported for Kotak Neo" });
      }

      if (!config.consumerKey || !config.mobileNumber || !config.ucc || !config.mpin) {
        return res.status(400).json({ 
          error: "Missing required credentials. Please configure Consumer Key, Mobile Number, UCC, and MPIN." 
        });
      }

      if (!totp) {
        return res.status(400).json({ error: "TOTP is required for authentication" });
      }

      const result = await authenticateKotakNeo({
        consumer_key: config.consumerKey,
        mobile_number: config.mobileNumber,
        ucc: config.ucc,
        mpin: config.mpin,
        totp: totp,
      });

      const updated = await storage.updateBrokerConfig(req.params.id, {
        isConnected: result.success,
        lastConnected: result.success ? now : config.lastConnected,
        connectionError: result.success ? null : result.error,
        accessToken: result.accessToken || null,
        sessionId: result.sessionId || null,
        baseUrl: result.baseUrl || null,
        lastTotpUsed: totp,
        lastTotpTime: now,
        totalLogins: (config.totalLogins || 0) + 1,
        successfulLogins: result.success ? (config.successfulLogins || 0) + 1 : (config.successfulLogins || 0),
        failedLogins: result.success ? (config.failedLogins || 0) : (config.failedLogins || 0) + 1,
        updatedAt: now,
      });

      res.json({ 
        success: result.success, 
        message: result.message,
        error: result.error,
        config: updated 
      });
    } catch (error) {
      res.status(500).json({ error: "Authentication failed", details: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  // Helper to get authenticated Kotak Neo session
  async function getAuthenticatedSession(): Promise<{ session: KotakNeoSession; consumerKey: string; brokerId: string } | null> {
    const configs = await storage.getBrokerConfigs();
    const kotakConfig = configs.find(c => 
      c.brokerName === "kotak_neo" && 
      c.isConnected && 
      c.accessToken && 
      c.sessionId && 
      c.baseUrl
    );
    
    if (!kotakConfig || !kotakConfig.accessToken || !kotakConfig.sessionId || !kotakConfig.baseUrl || !kotakConfig.consumerKey) {
      return null;
    }
    
    return {
      session: {
        viewToken: "", // Not needed for trading APIs
        sidView: "",
        sessionToken: kotakConfig.accessToken,
        sidSession: kotakConfig.sessionId,
        baseUrl: kotakConfig.baseUrl,
      },
      consumerKey: kotakConfig.consumerKey,
      brokerId: kotakConfig.id,
    };
  }

  // Trading Data Routes - fetches real data from Kotak Neo if authenticated
  app.get("/api/positions", async (req, res) => {
    try {
      const auth = await getAuthenticatedSession();
      
      if (auth) {
        // Fetch real positions from Kotak Neo
        const result = await getKotakPositions(auth.session);
        if (result.success && result.data) {
          // Transform Kotak Neo response to our format
          // Kotak Neo API field mappings (from /quick/user/positions):
          // - trdSym: Trading symbol (e.g., "RELIANCE-EQ", "COFORGE 1900 CALL 27 JAN")
          // - exSeg: Exchange segment (e.g., "nse_cm", "nse_fo")
          // - flBuyQty/flSellQty: Buy/Sell quantities
          // - buyAmt/sellAmt: Buy/Sell amounts for avg price calculation
          // - mtm: Mark to Market (total P&L)
          // - ltp: Last Traded Price
          // - prod: Product type (NRML, MIS, CNC)
          // - optTp: Option type (CE/PE for CALL/PUT)
          // - stkPrc: Strike price for options
          // - exDt: Expiry date
          // - realisedprofitloss/unrealisedprofitloss: Realised/Unrealised P&L
          const positions = (result.data as unknown[]).map((pos: unknown) => {
            const p = pos as Record<string, unknown>;
            const buyQty = Number(p.flBuyQty || p.buyQty || 0);
            const sellQty = Number(p.flSellQty || p.sellQty || 0);
            const buyAmt = Number(p.buyAmt || 0);
            const sellAmt = Number(p.sellAmt || 0);
            
            return {
              trading_symbol: String(p.trdSym || p.tradingSymbol || ""),
              exchange: String(p.exSeg || p.exchange || "NSE"),
              quantity: buyQty - sellQty,
              buy_avg: buyQty > 0 ? buyAmt / buyQty : 0,
              sell_avg: sellQty > 0 ? sellAmt / sellQty : 0,
              pnl: Number(p.mtm || p.pnl || 0),
              ltp: Number(p.ltp || 0),
              product_type: String(p.prod || p.productType || "NRML"),
              option_type: p.optTp ? String(p.optTp) : undefined,
              strike_price: p.stkPrc ? Number(p.stkPrc) : undefined,
              expiry: p.exDt ? String(p.exDt) : undefined,
              realised_pnl: Number(p.realisedprofitloss || p.realisedPnl || 0),
              unrealised_pnl: Number(p.unrealisedprofitloss || p.unrealisedPnl || 0),
            };
          });
          return res.json(positions);
        }
      }
      
      // Fallback to mock data
      const positions = await storage.getPositions();
      res.json(positions);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch positions" });
    }
  });

  app.get("/api/orders", async (req, res) => {
    try {
      const auth = await getAuthenticatedSession();
      
      if (auth) {
        // Fetch real orders from Kotak Neo
        const result = await getKotakOrders(auth.session);
        if (result.success && result.data) {
          // Transform Kotak Neo response to our format
          const orders = (result.data as unknown[]).map((ord: unknown) => {
            const o = ord as Record<string, unknown>;
            return {
              order_id: String(o.nOrdNo || o.orderId || ""),
              trading_symbol: String(o.trdSym || o.tradingSymbol || ""),
              transaction_type: String(o.trnsTp || o.transactionType || "B"),
              quantity: Number(o.qty || o.quantity || 0),
              price: Number(o.prc || o.price || 0),
              status: String(o.ordSt || o.status || "PENDING"),
              order_type: String(o.prcTp || o.orderType || "L"),
              exchange: String(o.exSeg || o.exchange || "NSE"),
              timestamp: String(o.ordDtTm || o.timestamp || new Date().toISOString()),
            };
          });
          return res.json(orders);
        }
      }
      
      // Fallback to mock data
      const orders = await storage.getOrders();
      res.json(orders);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch orders" });
    }
  });

  app.get("/api/holdings", async (req, res) => {
    try {
      const auth = await getAuthenticatedSession();
      
      if (auth) {
        // Fetch real holdings from Kotak Neo
        const result = await getKotakHoldings(auth.session);
        
        // Handle session expiration
        if (result.sessionExpired) {
          console.log("Session expired, clearing tokens for broker:", auth.brokerId);
          // Clear the expired session tokens
          await storage.updateBrokerConfig(auth.brokerId, {
            accessToken: null,
            sessionId: null,
            baseUrl: null,
            isConnected: false,
          });
        }
        
        if (result.success && result.data && Array.isArray(result.data) && result.data.length > 0) {
          // Log first item to understand Kotak holdings field structure
          console.log("First Kotak holding item:", JSON.stringify(result.data[0], null, 2));
          
          // Transform Kotak Neo response to our format
          // Kotak Neo API field mappings (from /portfolio/v1/holdings):
          // Fields: displaySymbol, symbol, quantity, averagePrice, mktValue, closingPrice, unrealisedGainLoss, prevDayLtp
          const holdings = (result.data as unknown[]).map((hld: unknown) => {
            const h = hld as Record<string, unknown>;
            const qty = Number(h.quantity || h.holdQty || h.qty || 0);
            const avgPrice = Number(h.averagePrice || h.avgPrc || h.avgPrice || 0);
            const prevClose = Number(h.closingPrice || h.prevDayLtp || h.prevClose || 0);
            
            // Current price: use mktValue/qty if available, else closingPrice
            let currentPrice = avgPrice;
            if (h.mktValue && qty > 0) {
              currentPrice = Number(h.mktValue) / qty;
            } else if (h.closingPrice && Number(h.closingPrice) > 0) {
              currentPrice = Number(h.closingPrice);
            }
            
            // Calculate values
            const investedValue = avgPrice * qty;
            const currentValue = Number(h.mktValue || currentPrice * qty);
            const pnl = Number(h.unrealisedGainLoss || h.unrealisedPnl || (currentPrice - avgPrice) * qty);
            const pnlPercent = avgPrice > 0 ? ((currentPrice - avgPrice) / avgPrice) * 100 : 0;
            
            // Today's P/L: difference from previous close
            const todayPnl = prevClose > 0 ? (currentPrice - prevClose) * qty : 0;
            const todayPnlPercent = prevClose > 0 ? ((currentPrice - prevClose) / prevClose) * 100 : 0;
            
            // Symbol: Kotak Neo uses displaySymbol or symbol
            const symbol = String(h.displaySymbol || h.dispSym || h.symbol || h.scrip || h.trdSym || h.tradingSymbol || h.scripName || "Unknown");
            
            return {
              trading_symbol: symbol,
              quantity: qty,
              average_price: avgPrice,
              current_price: currentPrice,
              invested_value: investedValue,
              current_value: currentValue,
              pnl: pnl,
              pnl_percent: pnlPercent,
              today_pnl: todayPnl,
              today_pnl_percent: todayPnlPercent,
              prev_close: prevClose,
            };
          });
          return res.json(holdings);
        }
      }
      
      // Fallback to mock data
      const holdings = await storage.getHoldings();
      res.json(holdings);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch holdings" });
    }
  });

  app.get("/api/portfolio-summary", async (req, res) => {
    try {
      const auth = await getAuthenticatedSession();
      
      if (auth) {
        // Fetch real limits/margin from Kotak Neo
        const limitsResult = await getKotakLimits(auth.session);
        const holdingsResult = await getKotakHoldings(auth.session);
        const positionsResult = await getKotakPositions(auth.session);
        
        let totalValue = 0;
        let dayPnL = 0;
        let totalPnL = 0;
        let availableMargin = 0;
        
        // Calculate from holdings
        if (holdingsResult.success && holdingsResult.data) {
          (holdingsResult.data as unknown[]).forEach((h: unknown) => {
            const hld = h as Record<string, unknown>;
            const qty = Number(hld.holdQty || hld.quantity || 0);
            const avgPrice = Number(hld.avgPrc || hld.averagePrice || 0);
            const currentPrice = Number(hld.ltp || hld.currentPrice || avgPrice);
            totalValue += currentPrice * qty;
            totalPnL += (currentPrice - avgPrice) * qty;
          });
        }
        
        // Calculate day P&L from positions
        if (positionsResult.success && positionsResult.data) {
          (positionsResult.data as unknown[]).forEach((p: unknown) => {
            const pos = p as Record<string, unknown>;
            dayPnL += Number(pos.mtm || pos.dayPnL || 0);
          });
        }
        
        // Get available margin
        if (limitsResult.success && limitsResult.data) {
          const limits = limitsResult.data as Record<string, unknown>;
          availableMargin = Number(limits.marginAvailable || limits.cash || limits.Net || 0);
          // Add margin to total value if not already counted
          if (totalValue === 0) {
            totalValue = availableMargin;
          }
        }
        
        return res.json({
          totalValue,
          dayPnL,
          totalPnL,
          availableMargin,
        });
      }
      
      // Fallback to mock data
      const summary = await storage.getPortfolioSummary();
      res.json(summary);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch portfolio summary" });
    }
  });

  // API to check broker session status
  app.get("/api/broker-session-status", async (req, res) => {
    try {
      const auth = await getAuthenticatedSession();
      res.json({
        isAuthenticated: !!auth,
        broker: auth ? "kotak_neo" : null,
      });
    } catch (error) {
      res.json({ isAuthenticated: false, broker: null });
    }
  });

  return httpServer;
}
