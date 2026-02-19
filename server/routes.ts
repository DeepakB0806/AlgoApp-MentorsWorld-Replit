import type { Express, Request } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertStrategySchema, insertWebhookSchema, insertBrokerConfigSchema, insertStrategyConfigSchema, insertStrategyPlanSchema, PREDEFINED_INDICATORS } from "@shared/schema";
import { sendEmail, getBaseUrlFromRequest } from "./services/email";

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
import {
  testBinanceConnectivity,
  authenticateBinance,
  getPositions as getBinancePositions,
  getOrderBook as getBinanceOrders,
  getHoldings as getBinanceHoldings,
  getAccountBalance as getBinanceBalance,
  getProxyStatus as getBinanceProxyStatus,
  type BinanceSession
} from "./binance-api";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  
  // Get Mail Settings (for admin settings page)
  app.get("/api/settings/mail", async (req, res) => {
    try {
      const apiKey = process.env.MAILJET_API_KEY || "";
      const secretKey = process.env.MAILJET_SECRET_KEY || "";
      
      // Clean the keys same way as email service does
      const cleanApiKey = apiKey.trim().replace(/[^a-f0-9]/gi, '');
      const cleanSecretKey = secretKey.trim().replace(/[^a-f0-9]/gi, '');
      
      res.json({
        apiKeyConfigured: !!apiKey,
        apiKeyLength: cleanApiKey.length,
        apiKeyRawLength: apiKey.length,
        secretKeyConfigured: !!secretKey,
        secretKeyLength: cleanSecretKey.length,
        secretKeyRawLength: secretKey.length,
        fromEmail: "algoapp@mentorsworld.org",
        fromName: "AlgoTrading Platform",
      });
    } catch (error: any) {
      console.error("Error getting mail settings:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Test Email Route (for verifying Mailjet SMTP configuration)
  app.post("/api/test-email", async (req, res) => {
    try {
      // Default to super admin email for testing
      const to = req.body?.to || "webadmin@mentorsworld.org";
      
      console.log(`Testing email to: ${to}`);
      console.log(`MAILJET_API_KEY exists: ${!!process.env.MAILJET_API_KEY}`);
      console.log(`MAILJET_SECRET_KEY exists: ${!!process.env.MAILJET_SECRET_KEY}`);
      
      const success = await sendEmail({
        to,
        subject: "AlgoTrading Platform - Email Test",
        textContent: "This is a test email from AlgoTrading Platform. If you received this, the Mailjet SMTP configuration is working correctly.",
        htmlContent: `
          <div style="font-family: Arial, sans-serif; padding: 20px;">
            <h2 style="color: #10b981;">Email Test Successful!</h2>
            <p>This is a test email from <strong>AlgoTrading Platform</strong>.</p>
            <p>If you received this, the Mailjet SMTP configuration is working correctly.</p>
            <p style="color: #666; font-size: 12px;">Sent at: ${new Date().toISOString()}</p>
          </div>
        `,
      });
      
      if (success) {
        res.json({ success: true, message: `Test email sent successfully to ${to}` });
      } else {
        res.status(500).json({ success: false, message: "Failed to send test email - check server logs" });
      }
    } catch (error: any) {
      console.error("Test email error:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

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

  function getUserFromRequest(req: any): { id: string; role: string } | null {
    if (req.teamUser) {
      return { id: req.teamUser.id, role: req.teamUser.role };
    }
    if (req.user?.claims?.sub) {
      return { id: req.user.claims.sub, role: "super_admin" };
    }
    return null;
  }

  function requireSuperAdmin(req: any, res: any): { id: string; role: string } | null {
    const user = getUserFromRequest(req);
    if (!user) {
      res.status(401).json({ error: "Authentication required" });
      return null;
    }
    if (user.role !== "super_admin") {
      res.status(403).json({ error: "Super Admin access required" });
      return null;
    }
    return user;
  }

  function requireTeamOrSuperAdmin(req: any, res: any): { id: string; role: string } | null {
    const user = getUserFromRequest(req);
    if (!user) {
      res.status(401).json({ error: "Authentication required" });
      return null;
    }
    if (user.role !== "super_admin" && user.role !== "team_member") {
      res.status(403).json({ error: "Team Member or Super Admin access required" });
      return null;
    }
    return user;
  }

  // ====== Strategy Configs (Mother Configurator) Routes - Super Admin Only ======
  app.get("/api/strategy-configs", async (req: any, res) => {
    try {
      const user = requireTeamOrSuperAdmin(req, res);
      if (!user) return;
      const configs = await storage.getStrategyConfigs();
      res.json(configs);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch strategy configs" });
    }
  });

  app.get("/api/strategy-configs/:id", async (req: any, res) => {
    try {
      const user = requireTeamOrSuperAdmin(req, res);
      if (!user) return;
      const config = await storage.getStrategyConfig(req.params.id);
      if (!config) {
        return res.status(404).json({ error: "Strategy config not found" });
      }
      res.json(config);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch strategy config" });
    }
  });

  app.post("/api/strategy-configs", async (req: any, res) => {
    try {
      const user = requireSuperAdmin(req, res);
      if (!user) return;
      const parsed = insertStrategyConfigSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid strategy config data", details: parsed.error });
      }
      const config = await storage.createStrategyConfig({ ...parsed.data, createdBy: user.id });
      res.status(201).json(config);
    } catch (error) {
      res.status(500).json({ error: "Failed to create strategy config" });
    }
  });

  app.patch("/api/strategy-configs/:id", async (req: any, res) => {
    try {
      const user = requireSuperAdmin(req, res);
      if (!user) return;
      const parsed = insertStrategyConfigSchema.partial().safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid strategy config data", details: parsed.error });
      }
      const existing = await storage.getStrategyConfig(req.params.id);
      if (!existing) {
        return res.status(404).json({ error: "Strategy config not found" });
      }
      const updateData = { ...parsed.data, configVersion: (existing.configVersion || 1) + 1 };
      const config = await storage.updateStrategyConfig(req.params.id, updateData);
      if (!config) {
        return res.status(404).json({ error: "Strategy config not found" });
      }
      res.json(config);
    } catch (error) {
      res.status(500).json({ error: "Failed to update strategy config" });
    }
  });

  app.delete("/api/strategy-configs/:id", async (req: any, res) => {
    try {
      const user = requireSuperAdmin(req, res);
      if (!user) return;
      const deleted = await storage.deleteStrategyConfig(req.params.id);
      if (!deleted) {
        return res.status(404).json({ error: "Strategy config not found" });
      }
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete strategy config" });
    }
  });

  app.get("/api/predefined-indicators", (req, res) => {
    res.json(PREDEFINED_INDICATORS);
  });

  app.get("/api/webhook-signals/:webhookId", async (req, res) => {
    try {
      const webhookId = req.params.webhookId;
      const fieldKeys = new Set<string>();

      const webhook = await storage.getWebhook(webhookId);
      if (webhook && webhook.fieldConfig) {
        try {
          const fields = JSON.parse(webhook.fieldConfig);
          if (Array.isArray(fields)) {
            fields.forEach((f: { key?: string; name?: string }) => {
              const k = f.key || f.name;
              if (k) fieldKeys.add(k);
            });
          }
        } catch {}
      }

      const logs = await storage.getWebhookLogsByWebhookId(webhookId);
      for (const log of logs) {
        if (log.payload) {
          try {
            const parsed = JSON.parse(log.payload);
            Object.keys(parsed).forEach((k) => fieldKeys.add(k));
          } catch {}
        }
      }

      if (fieldKeys.size === 0 && webhook?.linkedWebhookId) {
        const linkedLogs = await storage.getWebhookLogsByWebhookId(webhook.linkedWebhookId);
        for (const log of linkedLogs) {
          if (log.payload) {
            try {
              const parsed = JSON.parse(log.payload);
              Object.keys(parsed).forEach((k) => fieldKeys.add(k));
            } catch {}
          }
        }
      }

      res.json(Array.from(fieldKeys).sort());
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch webhook signals" });
    }
  });

  app.get("/api/webhook-field-values/:webhookId/:fieldKey", async (req, res) => {
    try {
      const { webhookId, fieldKey } = req.params;
      const uniqueValues = new Set<string>();

      const extractValuesFromLogs = (logs: { payload?: string | null }[]) => {
        for (const log of logs) {
          const raw = log.payload || (log as any).rawPayload;
          if (raw) {
            try {
              const parsed = JSON.parse(raw);
              const val = parsed[fieldKey];
              if (val !== undefined && val !== null && val !== "") {
                uniqueValues.add(String(val));
              }
            } catch {}
          }
        }
      };

      const logs = await storage.getWebhookLogsByWebhookId(webhookId);
      extractValuesFromLogs(logs);

      if (uniqueValues.size === 0) {
        const webhook = await storage.getWebhook(webhookId);
        if (webhook?.linkedWebhookId) {
          const linkedLogs = await storage.getWebhookLogsByWebhookId(webhook.linkedWebhookId);
          extractValuesFromLogs(linkedLogs);

          if (uniqueValues.size === 0) {
            const domainSetting = await storage.getSetting('domain_name');
            const domainName = domainSetting?.value;
            if (domainName) {
              try {
                const prodResponse = await fetch(
                  `https://${domainName}/api/webhook-data/webhook/${webhook.linkedWebhookId}`
                );
                if (prodResponse.ok) {
                  const prodData = await prodResponse.json();
                  if (Array.isArray(prodData)) {
                    extractValuesFromLogs(prodData);
                  }
                }
              } catch (fetchError) {
                console.log("Failed to fetch production data for field values:", fetchError);
              }
            }
          }
        }
      }

      res.json(Array.from(uniqueValues).sort());
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch field values" });
    }
  });

  // ====== Strategy Plans (Trade Planning) Routes - Team + Super Admin ======
  app.get("/api/strategy-plans", async (req: any, res) => {
    try {
      const user = requireTeamOrSuperAdmin(req, res);
      if (!user) return;
      const plans = await storage.getStrategyPlans();
      res.json(plans);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch strategy plans" });
    }
  });

  app.get("/api/strategy-plans/config/:configId", async (req: any, res) => {
    try {
      const user = requireTeamOrSuperAdmin(req, res);
      if (!user) return;
      const plans = await storage.getStrategyPlansByConfig(req.params.configId);
      res.json(plans);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch strategy plans" });
    }
  });

  app.get("/api/strategy-plans/:id", async (req: any, res) => {
    try {
      const user = requireTeamOrSuperAdmin(req, res);
      if (!user) return;
      const plan = await storage.getStrategyPlan(req.params.id);
      if (!plan) {
        return res.status(404).json({ error: "Strategy plan not found" });
      }
      res.json(plan);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch strategy plan" });
    }
  });

  app.post("/api/strategy-plans", async (req: any, res) => {
    try {
      const user = requireTeamOrSuperAdmin(req, res);
      if (!user) return;
      const parsed = insertStrategyPlanSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid strategy plan data", details: parsed.error });
      }
      const plan = await storage.createStrategyPlan({ ...parsed.data, createdBy: user.id });
      res.status(201).json(plan);
    } catch (error) {
      res.status(500).json({ error: "Failed to create strategy plan" });
    }
  });

  app.patch("/api/strategy-plans/:id", async (req: any, res) => {
    try {
      const user = requireTeamOrSuperAdmin(req, res);
      if (!user) return;
      const parsed = insertStrategyPlanSchema.partial().safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid strategy plan data", details: parsed.error });
      }
      const plan = await storage.updateStrategyPlan(req.params.id, parsed.data);
      if (!plan) {
        return res.status(404).json({ error: "Strategy plan not found" });
      }
      res.json(plan);
    } catch (error) {
      res.status(500).json({ error: "Failed to update strategy plan" });
    }
  });

  app.delete("/api/strategy-plans/:id", async (req: any, res) => {
    try {
      const user = requireTeamOrSuperAdmin(req, res);
      if (!user) return;
      const deleted = await storage.deleteStrategyPlan(req.params.id);
      if (!deleted) {
        return res.status(404).json({ error: "Strategy plan not found" });
      }
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete strategy plan" });
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

  // Get webhooks that link TO this webhook (inbound links)
  app.get("/api/webhooks/:id/inbound-links", async (req, res) => {
    try {
      const inboundLinks = await storage.getWebhooksLinkingTo(req.params.id);
      res.json(inboundLinks);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch inbound links" });
    }
  });

  app.post("/api/webhooks", async (req, res) => {
    try {
      const parsed = insertWebhookSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid webhook data", details: parsed.error });
      }
      
      // Create webhook first
      const webhook = await storage.createWebhook(parsed.data);
      
      // Generate webhook URL: prefer request-derived URL, fallback to domain setting
      const requestBaseUrl = getBaseUrlFromRequest(req);
      let generatedUrl: string;
      
      if (requestBaseUrl && requestBaseUrl.startsWith("http")) {
        generatedUrl = `${requestBaseUrl}/api/webhook/${webhook.id}`;
      } else {
        const domainSetting = await storage.getSetting("domain_name");
        generatedUrl = domainSetting?.value 
          ? `https://${domainSetting.value}/api/webhook/${webhook.id}`
          : `/api/webhook/${webhook.id}`;
      }
      
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

  // Sync webhook registry from production
  app.post("/api/webhook-registry/sync", async (req, res) => {
    try {
      const domainSetting = await storage.getSetting("domain_name");
      if (!domainSetting || !domainSetting.value) {
        return res.status(400).json({ error: "Production domain not configured. Please set domain name in settings." });
      }
      
      const productionUrl = `https://${domainSetting.value}/api/webhook-registry`;
      
      // Fetch registry from production
      const response = await fetch(productionUrl, {
        headers: { "Accept": "application/json" },
        signal: AbortSignal.timeout(10000), // 10 second timeout
      });
      
      if (!response.ok) {
        return res.status(502).json({ error: `Failed to fetch from production: ${response.status} ${response.statusText}` });
      }
      
      const productionRegistry = await response.json() as any[];
      
      // Merge with local registry (upsert by unique_code)
      let synced = 0;
      let skipped = 0;
      
      for (const entry of productionRegistry) {
        // Check if already exists locally
        const existing = await storage.getWebhookRegistryEntry(entry.uniqueCode || entry.unique_code);
        if (!existing) {
          // Add to local registry
          await storage.createWebhookRegistryEntry({
            uniqueCode: entry.uniqueCode || entry.unique_code,
            webhookId: entry.webhookId || entry.webhook_id,
            webhookName: entry.webhookName || entry.webhook_name,
            createdBy: entry.createdBy || entry.created_by || "production-sync",
            isActive: entry.isActive ?? entry.is_active ?? true,
            notes: `Synced from production on ${new Date().toISOString()}`,
          });
          synced++;
        } else {
          skipped++;
        }
      }
      
      res.json({ 
        success: true, 
        synced, 
        skipped, 
        total: productionRegistry.length,
        message: `Synced ${synced} new webhooks from production (${skipped} already existed)` 
      });
    } catch (error: any) {
      console.error("Sync error:", error);
      res.status(500).json({ error: error.message || "Failed to sync webhook registry" });
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

      // Extract TradingView fields (supports snake_case, camelCase, UPPERCASE, Title_Case, and make.com formats)
      const logData = {
        webhookId,
        timestamp: new Date().toISOString(),
        payload: JSON.stringify(payload),
        status: "success" as const,
        response: "Alert received and processed",
        executionTime: 0,
        ipAddress,
        userAgent,
        // 1. TIME AS PER UNIX (TIMESTAMP) - make.com uses "TimeStamp"
        timeUnix: parseNumeric(payload.TimeStamp ?? payload.time_unix ?? payload.timeUnix ?? payload.TIME_UNIX ?? payload.Time_Unix ?? payload.timestamp ?? payload.TIMESTAMP ?? payload.Timestamp),
        // 2. EXCHANGE
        exchange: payload.exchange || payload.EXCHANGE || payload.Exchange,
        // 3. TICKER (INDICES)
        indices: payload.indices || payload.INDICES || payload.Indices || payload.ticker || payload.TICKER || payload.Ticker,
        // 4. INDICATOR
        indicator: payload.indicator || payload.INDICATOR || payload.Indicator,
        // 5. ACTION (ALERT)
        alert: payload.alert || payload.ALERT || payload.Alert || payload.action || payload.ACTION || payload.Action,
        // 6. PRICE
        price: parseNumeric(payload.price ?? payload.PRICE ?? payload.Price),
        // 7. LOCAL TIME - make.com uses "LocalTime"
        localTime: payload.LocalTime || payload.local_time || payload.localTime || payload.LOCAL_TIME || payload.Local_Time,
        // 8. MODE
        mode: payload.mode || payload.MODE || payload.Mode,
        // 9. MODE DESC - make.com uses "Mode_Description"
        modeDesc: payload.Mode_Description || payload.mode_desc || payload.modeDesc || payload.MODE_DESC || payload.Mode_Desc || payload["Mode Description"],
        // 10. FAST LINE (FIRST LINE) - make.com uses "Fast_Line"
        firstLine: parseNumeric(payload.Fast_Line ?? payload.first_line ?? payload.fast_line ?? payload.FIRST_LINE ?? payload.FAST_LINE ?? payload.First_Line ?? payload.firstLine ?? payload.fastLine ?? payload["Fast Line"]),
        // 11. MID LINE - make.com uses "Mid_Line"
        midLine: parseNumeric(payload.Mid_Line ?? payload.mid_line ?? payload.MID_LINE ?? payload.midLine ?? payload["Mid Line"]),
        // 12. SLOW LINE - make.com uses "Slow_Line"
        slowLine: parseNumeric(payload.Slow_Line ?? payload.slow_line ?? payload.SLOW_LINE ?? payload.slowLine ?? payload["Slow Line"]),
        // 13. SUPERTREND (ST) - make.com uses "SuperTrend_ST"
        st: parseNumeric(payload.SuperTrend_ST ?? payload.st ?? payload.ST ?? payload.St ?? payload.supertrend ?? payload.SUPERTREND ?? payload.Supertrend ?? payload.Super_Trend ?? payload["SuperTrend ST"]),
        // 14. HALF TREND (HT) - make.com uses "Half_Trend_HT"
        ht: parseNumeric(payload.Half_Trend_HT ?? payload.ht ?? payload.HT ?? payload.Ht ?? payload.halftrend ?? payload.HALFTREND ?? payload.Halftrend ?? payload.half_trend ?? payload.HALF_TREND ?? payload.Half_Trend ?? payload["Half Trend HT"]),
        // 15. RSI
        rsi: parseNumeric(payload.rsi ?? payload.RSI ?? payload.Rsi),
        // 16. RSI SCALED - make.com uses "RSI_Scaled"
        rsiScaled: parseNumeric(payload.RSI_Scaled ?? payload.rsi_scaled ?? payload.RSI_SCALED ?? payload.Rsi_Scaled ?? payload.rsiScaled ?? payload["RSI Scaled"]),
        // 17. ALERT SYSTEM
        alertSystem: payload.alert_system || payload.alertSystem || payload.ALERT_SYSTEM || payload.Alert_System,
        // 18. ACTION BINARY (ACTION TYPE)
        actionBinary: parseNumeric(payload.action_binary ?? payload.ACTION_BINARY ?? payload.Action_Binary ?? payload.actionBinary ?? payload.action_type ?? payload.ACTION_TYPE ?? payload.Action_Type),
        // 19. LOCK STATE - make.com uses "Lock State" (with space!)
        lockState: payload["Lock State"] || payload.lock_state || payload.lockState || payload.LOCK_STATE || payload.Lock_State,
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

      let paperTradeResults: any[] = [];
      if (webhook.strategyId && (signalType === "buy" || signalType === "sell")) {
        try {
          const { processPaperTrade } = await import("./paper-trade-engine");
          const latestData = await storage.getLatestWebhookData(webhookId);
          if (latestData) {
            paperTradeResults = await processPaperTrade(storage, latestData, webhook.strategyId);
            console.log("Paper trade results:", JSON.stringify(paperTradeResults));
          }
        } catch (ptError) {
          console.error("Paper trade processing error:", ptError);
        }
      }

      res.json({ 
        success: true, 
        message: "Webhook processed successfully",
        action: logData.actionBinary === 1 ? "BUY" : logData.actionBinary === 0 ? "SELL" : "UNKNOWN",
        signal: signalType,
        paperTrades: paperTradeResults.length > 0 ? paperTradeResults : undefined,
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

  // Delete old logs (cleanup by days)
  app.delete("/api/webhooks/:id/logs/cleanup", async (req, res) => {
    try {
      const daysToKeep = parseInt(req.query.days as string) || 30;
      const deletedCount = await storage.deleteOldWebhookLogs(req.params.id, daysToKeep);
      res.json({ success: true, deletedCount, daysToKeep });
    } catch (error) {
      res.status(500).json({ error: "Failed to cleanup logs" });
    }
  });

  // Delete ALL logs for a webhook
  app.delete("/api/webhooks/:id/logs/clear-all", async (req, res) => {
    try {
      const deletedCount = await storage.deleteAllWebhookLogs(req.params.id);
      res.json({ success: true, deletedCount });
    } catch (error) {
      res.status(500).json({ error: "Failed to clear all logs" });
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
      
      // If linked to production, fetch from production API
      if (webhook?.linkedWebhookId) {
        const domainSetting = await storage.getSetting('domain_name');
        const domainName = domainSetting?.value;
        
        if (domainName) {
          try {
            const productionResponse = await fetch(
              `https://${domainName}/api/webhook-data/webhook/${effectiveWebhookId}`
            );
            if (productionResponse.ok) {
              const productionData = await productionResponse.json();
              return res.json(productionData);
            }
          } catch (fetchError) {
            console.log("Failed to fetch from production, falling back to local:", fetchError);
          }
        }
      }
      
      const data = await storage.getWebhookDataByWebhook(effectiveWebhookId);
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch webhook data" });
    }
  });

  // Link webhook to production webhook data stream by unique code or webhook ID
  app.post("/api/webhooks/:id/link", async (req, res) => {
    try {
      let { uniqueCode, webhookId } = req.body;
      
      if (!uniqueCode && !webhookId) {
        return res.status(400).json({ error: "Either uniqueCode or webhookId is required" });
      }
      
      // Strip D- or P- prefix from uniqueCode if present
      if (uniqueCode && (uniqueCode.startsWith("D-") || uniqueCode.startsWith("P-"))) {
        uniqueCode = uniqueCode.substring(2);
      }
      
      let linkedId: string;
      let productionWebhook = null;
      let registryEntry = null;
      
      if (webhookId) {
        // Direct link by webhook ID (for cross-database linking)
        linkedId = webhookId;
        // Try to find the webhook locally for display, but don't fail if not found
        productionWebhook = await storage.getWebhook(webhookId);
      } else {
        // First try to find the webhook locally by unique code
        productionWebhook = await storage.getWebhookByUniqueCode(uniqueCode);
        
        if (productionWebhook) {
          linkedId = productionWebhook.id;
        } else {
          // If not found locally, check the synced registry
          registryEntry = await storage.getWebhookRegistryEntry(uniqueCode);
          if (registryEntry && registryEntry.webhookId) {
            // Use the webhook ID from the registry (synced from production)
            linkedId = registryEntry.webhookId;
          } else {
            return res.status(404).json({ 
              error: "No webhook found with that code. Try syncing from production first, or use the webhook ID directly.",
              hint: "Click 'Sync from Production' to fetch the latest webhook codes."
            });
          }
        }
      }
      
      // Get the dev webhook to send its code to production
      const devWebhook = await storage.getWebhook(req.params.id);
      if (!devWebhook) {
        return res.status(404).json({ error: "Webhook not found" });
      }
      
      // Link to the production webhook's ID
      const webhook = await storage.updateWebhook(req.params.id, { linkedWebhookId: linkedId });
      if (!webhook) {
        return res.status(404).json({ error: "Webhook not found" });
      }
      
      // Try to register the link on production (non-blocking)
      const domainSetting = await storage.getSetting('domain_name');
      if (domainSetting?.value) {
        try {
          const productionUrl = `https://${domainSetting.value}/api/webhooks/${linkedId}/register-link`;
          await fetch(productionUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ devWebhookCode: devWebhook.uniqueCode }),
          });
        } catch (err) {
          // Log but don't fail - production may not be reachable
          console.log("Could not register link on production (non-blocking):", err);
        }
      }
      
      res.json({ success: true, webhook, linkedWebhook: productionWebhook, registryEntry });
    } catch (error) {
      res.status(500).json({ error: "Failed to link webhook" });
    }
  });

  // Unlink webhook from production data stream
  app.delete("/api/webhooks/:id/link", async (req, res) => {
    try {
      // Get the webhook before unlinking to access its linkedWebhookId and uniqueCode
      const existingWebhook = await storage.getWebhook(req.params.id);
      if (!existingWebhook) {
        return res.status(404).json({ error: "Webhook not found" });
      }
      
      const linkedId = existingWebhook.linkedWebhookId;
      const devCode = existingWebhook.uniqueCode;
      
      const webhook = await storage.updateWebhook(req.params.id, { linkedWebhookId: null });
      
      // Try to unregister the link on production (non-blocking)
      if (linkedId) {
        const domainSetting = await storage.getSetting('domain_name');
        if (domainSetting?.value) {
          try {
            const productionUrl = `https://${domainSetting.value}/api/webhooks/${linkedId}/unregister-link`;
            await fetch(productionUrl, {
              method: 'DELETE',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ devWebhookCode: devCode }),
            });
          } catch (err) {
            // Log but don't fail - production may not be reachable
            console.log("Could not unregister link on production (non-blocking):", err);
          }
        }
      }
      
      res.json({ success: true, webhook });
    } catch (error) {
      res.status(500).json({ error: "Failed to unlink webhook" });
    }
  });

  // Register a dev webhook link (called by dev environment when linking)
  app.post("/api/webhooks/:id/register-link", async (req, res) => {
    try {
      const { devWebhookCode } = req.body;
      
      if (!devWebhookCode) {
        return res.status(400).json({ error: "devWebhookCode is required" });
      }
      
      const webhook = await storage.getWebhook(req.params.id);
      if (!webhook) {
        return res.status(404).json({ error: "Webhook not found" });
      }
      
      // Get current linked webhooks array or initialize empty
      const linkedByWebhooks = webhook.linkedByWebhooks || [];
      
      // Add the dev webhook code if not already present
      if (!linkedByWebhooks.includes(devWebhookCode)) {
        linkedByWebhooks.push(devWebhookCode);
        await storage.updateWebhook(req.params.id, { linkedByWebhooks });
      }
      
      res.json({ success: true, linkedByWebhooks });
    } catch (error) {
      console.error("Failed to register link:", error);
      res.status(500).json({ error: "Failed to register link" });
    }
  });

  // Unregister a dev webhook link (called by dev environment when unlinking)
  app.delete("/api/webhooks/:id/unregister-link", async (req, res) => {
    try {
      const { devWebhookCode } = req.body;
      
      if (!devWebhookCode) {
        return res.status(400).json({ error: "devWebhookCode is required" });
      }
      
      const webhook = await storage.getWebhook(req.params.id);
      if (!webhook) {
        return res.status(404).json({ error: "Webhook not found" });
      }
      
      // Remove the dev webhook code from the array
      const linkedByWebhooks = (webhook.linkedByWebhooks || []).filter(
        (code: string) => code !== devWebhookCode
      );
      
      await storage.updateWebhook(req.params.id, { linkedByWebhooks });
      
      res.json({ success: true, linkedByWebhooks });
    } catch (error) {
      console.error("Failed to unregister link:", error);
      res.status(500).json({ error: "Failed to unregister link" });
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

  // Delete webhook data logs
  app.delete("/api/webhook-data/webhook/:webhookId/cleanup", async (req, res) => {
    try {
      const daysToKeep = parseInt(req.query.days as string) || 30;
      const deletedCount = await storage.deleteWebhookData(req.params.webhookId, daysToKeep);
      res.json({ success: true, deletedCount, daysToKeep });
    } catch (error) {
      res.status(500).json({ error: "Failed to cleanup webhook data" });
    }
  });

  // Delete webhook data older than X days (all webhooks)
  app.delete("/api/webhook-data/cleanup", async (req, res) => {
    try {
      const daysToKeep = parseInt(req.query.days as string) || 30;
      const deletedCount = await storage.deleteWebhookDataOlderThan(daysToKeep);
      res.json({ success: true, deletedCount, daysToKeep });
    } catch (error) {
      res.status(500).json({ error: "Failed to cleanup webhook data" });
    }
  });

  // Delete all webhook data logs
  app.delete("/api/webhook-data/cleanup-all", async (req, res) => {
    try {
      const deletedCount = await storage.deleteAllWebhookData();
      res.json({ success: true, deletedCount });
    } catch (error) {
      res.status(500).json({ error: "Failed to cleanup all webhook data" });
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

  app.get("/api/binance/proxy-status", async (_req, res) => {
    res.json(getBinanceProxyStatus());
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
      const startTime = Date.now();

      let result: { success: boolean; message: string; error?: string };

      if (config.brokerName === "paper_trade") {
        result = { success: true, message: "Paper Trade engine is ready — no external connection needed" };
      } else if (config.brokerName === "kotak_neo") {
        if (!config.consumerKey) {
          return res.status(400).json({ 
            success: false, 
            error: "Consumer Key (API Token) is required for Kotak Neo" 
          });
        }
        result = await testKotakNeoConnectivity(config.consumerKey);
      } else if (config.brokerName === "binance") {
        const isTestnet = config.environment !== "prod";
        result = await testBinanceConnectivity(config.consumerKey || "", config.consumerSecret || "", isTestnet);
      } else {
        result = { success: false, message: "Broker not yet supported for live connectivity test" };
      }

      const responseTime = Date.now() - startTime;

      if (result.success || config.brokerName === "kotak_neo" || config.brokerName === "binance" || config.brokerName === "paper_trade") {
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

        await storage.createBrokerTestLog({
          brokerConfigId: req.params.id,
          status: result.success ? "success" : "failed",
          message: result.message || null,
          errorMessage: result.error || null,
          responseTime,
          testedAt: now,
        });

        return res.json({ 
          success: result.success, 
          message: result.message,
          error: result.error,
          config: updated 
        });
      }

      // Fallback for unsupported brokers
      const updated2 = await storage.updateBrokerConfig(req.params.id, {
        isConnected: false,
        connectionError: "Broker not yet supported for live connectivity test",
        lastTestTime: now,
        lastTestResult: "failed",
        lastTestMessage: "Broker not yet supported",
        totalTests: (config.totalTests || 0) + 1,
        updatedAt: now,
      });

      await storage.createBrokerTestLog({
        brokerConfigId: req.params.id,
        status: "failed",
        message: "Broker not yet supported",
        errorMessage: null,
        responseTime,
        testedAt: now,
      });

      res.json({ success: false, message: "Broker not yet supported", config: updated2 });
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

      if (config.brokerName === "paper_trade") {
        const updated = await storage.updateBrokerConfig(req.params.id, {
          isConnected: true,
          lastConnected: now,
          connectionError: null,
          totalLogins: (config.totalLogins || 0) + 1,
          successfulLogins: (config.successfulLogins || 0) + 1,
          updatedAt: now,
        });

        await storage.createBrokerSessionLog({
          brokerConfigId: req.params.id,
          status: "success",
          message: "Paper Trade engine activated — ready for simulated trading",
          loginAt: now,
        });

        return res.json({
          success: true,
          message: "Paper Trade engine activated",
          config: updated,
        });
      }

      if (config.brokerName === "binance") {
        if (!config.consumerKey || !config.consumerSecret) {
          return res.status(400).json({ 
            error: "API Key and Secret Key are required for Binance authentication" 
          });
        }

        const isTestnet = config.environment !== "prod";
        const result = await authenticateBinance({
          api_key: config.consumerKey,
          api_secret: config.consumerSecret,
          is_testnet: isTestnet,
        });

        const updated = await storage.updateBrokerConfig(req.params.id, {
          isConnected: result.success,
          lastConnected: result.success ? now : config.lastConnected,
          connectionError: result.success ? null : result.error,
          accessToken: result.accessToken || null,
          sessionId: result.sessionId || null,
          baseUrl: result.baseUrl || null,
          totalLogins: (config.totalLogins || 0) + 1,
          successfulLogins: result.success ? (config.successfulLogins || 0) + 1 : (config.successfulLogins || 0),
          failedLogins: result.success ? (config.failedLogins || 0) : (config.failedLogins || 0) + 1,
          updatedAt: now,
        });

        await storage.createBrokerSessionLog({
          brokerConfigId: req.params.id,
          status: result.success ? "success" : "failed",
          message: result.message || null,
          errorMessage: result.error || null,
          totpUsed: null,
          accessToken: result.accessToken || null,
          sessionId: result.sessionId || null,
          baseUrl: result.baseUrl || null,
          sessionExpiry: null,
          loginAt: now,
        });

        return res.json({ 
          success: result.success, 
          message: result.message,
          error: result.error,
          config: updated 
        });
      }
      
      if (config.brokerName !== "kotak_neo") {
        return res.status(400).json({ error: "Authentication not yet supported for this broker" });
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
        environment: config.environment || "prod",
      });

      let sessionExpiry: string | null = null;
      if (result.accessToken) {
        try {
          const parts = result.accessToken.split('.');
          if (parts.length === 3) {
            const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
            if (payload.exp) {
              sessionExpiry = new Date(payload.exp * 1000).toISOString().replace('T', ' ').slice(0, 19);
            }
          }
        } catch {
          // JWT parsing failed, expiry will be null
        }
      }

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

      await storage.createBrokerSessionLog({
        brokerConfigId: req.params.id,
        status: result.success ? "success" : "failed",
        message: result.message || null,
        errorMessage: result.error || null,
        totpUsed: totp,
        accessToken: result.accessToken || null,
        sessionId: result.sessionId || null,
        baseUrl: result.baseUrl || null,
        sessionExpiry,
        loginAt: now,
      });

      res.json({ 
        success: result.success, 
        message: result.message,
        error: result.error,
        sessionExpiry,
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

  // Helper to get authenticated session for a specific broker config
  async function getAuthenticatedSessionByConfigId(configId: string): Promise<{ session: KotakNeoSession; consumerKey: string; brokerId: string } | null> {
    const config = await storage.getBrokerConfig(configId);
    if (!config || !config.isConnected || !config.accessToken || !config.sessionId || !config.baseUrl || !config.consumerKey) {
      return null;
    }
    return {
      session: {
        viewToken: "",
        sidView: "",
        sessionToken: config.accessToken,
        sidSession: config.sessionId,
        baseUrl: config.baseUrl,
      },
      consumerKey: config.consumerKey,
      brokerId: config.id,
    };
  }

  function getBinanceSessionFromConfig(config: { consumerKey: string | null; consumerSecret: string | null; environment: string | null }): BinanceSession | null {
    if (!config.consumerKey || !config.consumerSecret) return null;
    return {
      apiKey: config.consumerKey,
      apiSecret: config.consumerSecret,
      isTestnet: config.environment !== "prod",
    };
  }

  // Broker-config-scoped positions endpoint
  app.get("/api/positions/:brokerConfigId", async (req, res) => {
    try {
      const { brokerConfigId } = req.params;
      const brokerConfig = await storage.getBrokerConfig(brokerConfigId);
      if (!brokerConfig || !brokerConfig.isConnected) {
        return res.status(400).json({ error: "Broker not connected or session expired" });
      }

      if (brokerConfig.brokerName === "binance") {
        const binanceSession = getBinanceSessionFromConfig(brokerConfig);
        if (!binanceSession) {
          return res.status(400).json({ error: "Binance API credentials missing" });
        }
        const result = await getBinancePositions(binanceSession);
        return res.json(result.success && result.data ? result.data : []);
      }

      const auth = await getAuthenticatedSessionByConfigId(brokerConfigId);
      if (!auth) {
        return res.status(400).json({ error: "Broker not connected or session expired" });
      }
      const result = await getKotakPositions(auth.session);
      if (result.success && result.data) {
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
            buy_qty: buyQty,
            sell_qty: sellQty,
            buy_avg: buyQty > 0 ? buyAmt / buyQty : 0,
            sell_avg: sellQty > 0 ? sellAmt / sellQty : 0,
            buy_amt: buyAmt,
            sell_amt: sellAmt,
            pnl: Number(p.mtm || p.pnl || 0),
            ltp: Number(p.ltp || 0),
            product_type: String(p.prod || p.productType || "NRML"),
            option_type: p.optTp ? String(p.optTp) : undefined,
            strike_price: p.stkPrc ? Number(p.stkPrc) : undefined,
            expiry: p.exDt ? String(p.exDt) : undefined,
            realised_pnl: Number(p.realisedprofitloss || p.realisedPnl || 0),
            unrealised_pnl: Number(p.unrealisedprofitloss || p.unrealisedPnl || 0),
            token: String(p.tok || p.token || ""),
          };
        });
        return res.json(positions);
      }
      res.json([]);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch positions for broker config" });
    }
  });

  // Update deployment status for a strategy plan
  app.patch("/api/strategy-plans/:id/deployment", async (req, res) => {
    try {
      const { id } = req.params;
      const { deploymentStatus } = req.body;
      const validStatuses = ["draft", "deployed", "active", "paused", "squared_off", "closed", "archived"];
      if (!validStatuses.includes(deploymentStatus)) {
        return res.status(400).json({ error: `Invalid deployment status. Must be one of: ${validStatuses.join(", ")}` });
      }
      const plan = await storage.getStrategyPlan(id);
      if (!plan) {
        return res.status(404).json({ error: "Strategy plan not found" });
      }
      const allowedTransitions: Record<string, string[]> = {
        draft: ["deployed"],
        deployed: ["active", "closed"],
        active: ["paused", "squared_off", "closed"],
        paused: ["active", "squared_off", "closed"],
        squared_off: ["active", "closed"],
        closed: ["archived", "deployed"],
        archived: ["deployed"],
      };
      const currentStatus = plan.deploymentStatus || "draft";
      const allowed = allowedTransitions[currentStatus] || [];
      if (!allowed.includes(deploymentStatus)) {
        return res.status(400).json({ error: `Cannot transition from '${currentStatus}' to '${deploymentStatus}'. Allowed: ${allowed.join(", ")}` });
      }
      const updateData: Record<string, unknown> = { deploymentStatus, updatedAt: new Date().toISOString() };
      if (deploymentStatus === "deployed") {
        const parentConfig = await storage.getStrategyConfig(plan.configId);
        if (parentConfig) {
          updateData.deployedConfigVersion = parentConfig.configVersion || 1;
        }
      }
      if (req.body.brokerConfigId !== undefined && deploymentStatus === "deployed" && (currentStatus === "closed" || currentStatus === "archived")) {
        updateData.brokerConfigId = req.body.brokerConfigId;
      }
      if (req.body.lotMultiplier !== undefined) {
        const lm = Number(req.body.lotMultiplier);
        if (!isNaN(lm) && lm >= 1 && lm <= 10) updateData.lotMultiplier = Math.round(lm);
      }
      if (req.body.deployStoploss !== undefined) {
        const sl = Number(req.body.deployStoploss);
        if (!isNaN(sl) && sl >= 0) updateData.deployStoploss = sl;
      }
      if (req.body.deployProfitTarget !== undefined) {
        const pt = Number(req.body.deployProfitTarget);
        if (!isNaN(pt) && pt >= 0) updateData.deployProfitTarget = pt;
      }
      const updated = await storage.updateStrategyPlan(id, updateData as any);
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: "Failed to update deployment status" });
    }
  });

  // Strategy Trades - records of trades executed by strategy plans
  app.get("/api/strategy-trades/:planId", async (req, res) => {
    try {
      const { planId } = req.params;
      const trades = await storage.getStrategyTradesByPlan(planId);
      res.json(trades);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch strategy trades" });
    }
  });

  app.post("/api/strategy-trades", async (req, res) => {
    try {
      const trade = await storage.createStrategyTrade({
        ...req.body,
        createdAt: new Date().toISOString(),
      });
      res.json(trade);
    } catch (error) {
      res.status(500).json({ error: "Failed to create strategy trade" });
    }
  });

  // Strategy Daily P&L log entries
  app.get("/api/strategy-daily-pnl/:planId", async (req, res) => {
    try {
      const { planId } = req.params;
      const entries = await storage.getStrategyDailyPnl(planId);
      res.json(entries);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch daily P&L logs" });
    }
  });

  app.post("/api/strategy-daily-pnl", async (req, res) => {
    try {
      const entry = await storage.createStrategyDailyPnl({
        ...req.body,
        createdAt: new Date().toISOString(),
      });
      res.json(entry);
    } catch (error) {
      res.status(500).json({ error: "Failed to create daily P&L entry" });
    }
  });

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

  // Broker Test Logs
  app.get("/api/broker-configs/:id/test-logs", async (req, res) => {
    try {
      const logs = await storage.getBrokerTestLogs(req.params.id);
      res.json(logs);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch test logs" });
    }
  });

  app.delete("/api/broker-configs/:id/test-logs", async (req, res) => {
    try {
      let days: number | undefined;
      if (req.query.days) {
        days = parseInt(req.query.days as string);
        if (!Number.isFinite(days) || days <= 0) {
          return res.status(400).json({ error: "Invalid days parameter" });
        }
      }
      const deletedCount = await storage.deleteBrokerTestLogs(req.params.id, days);
      res.json({ success: true, deletedCount });
    } catch (error) {
      res.status(500).json({ error: "Failed to clear test logs" });
    }
  });

  // Broker Session Logs
  app.get("/api/broker-configs/:id/session-logs", async (req, res) => {
    try {
      const logs = await storage.getBrokerSessionLogs(req.params.id);
      res.json(logs);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch session logs" });
    }
  });

  app.delete("/api/broker-configs/:id/session-logs", async (req, res) => {
    try {
      let days: number | undefined;
      if (req.query.days) {
        days = parseInt(req.query.days as string);
        if (!Number.isFinite(days) || days <= 0) {
          return res.status(400).json({ error: "Invalid days parameter" });
        }
      }
      const deletedCount = await storage.deleteBrokerSessionLogs(req.params.id, days);
      res.json({ success: true, deletedCount });
    } catch (error) {
      res.status(500).json({ error: "Failed to clear session logs" });
    }
  });

  // API to check broker session status
  app.get("/api/broker-session-status", async (req, res) => {
    try {
      const configs = await storage.getBrokerConfigs();
      const connectedBrokers = configs
        .filter(c => c.isConnected)
        .map(c => ({ id: c.id, broker: c.brokerName, name: c.name, environment: c.environment }));

      const auth = await getAuthenticatedSession();
      res.json({
        isAuthenticated: !!auth || connectedBrokers.length > 0,
        broker: auth ? "kotak_neo" : (connectedBrokers.length > 0 ? connectedBrokers[0].broker : null),
        connectedBrokers,
      });
    } catch (error) {
      res.json({ isAuthenticated: false, broker: null, connectedBrokers: [] });
    }
  });

  return httpServer;
}
