import type { Express } from "express";
import type { IStorage } from "../storage";
import { sendEmail } from "../services/email";
import { rescheduleScripMasterSync } from "../scrip-sync-scheduler";

export function registerAdminRoutes(app: Express, storage: IStorage) {
  app.get("/api/settings/mail", async (req, res) => {
    try {
      const apiKey = process.env.MAILJET_API_KEY || "";
      const secretKey = process.env.MAILJET_SECRET_KEY || "";
      
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

  app.post("/api/test-email", async (req, res) => {
    try {
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
      if (req.params.key === "scrip_master_sync_time") {
        rescheduleScripMasterSync(storage).catch(err =>
          console.error(`[SCRIP-MASTER] Failed to reschedule after settings save: ${err}`)
        );
      }
      res.json(setting);
    } catch (error) {
      res.status(500).json({ error: "Failed to save setting" });
    }
  });

  app.get("/api/webhook-logs", async (req, res) => {
    try {
      const logs = await storage.getWebhookLogs();
      res.json(logs);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch webhook logs" });
    }
  });

  app.post("/api/admin/sync-data", async (req, res) => {
    try {
      const syncKey = req.headers["x-sync-key"];
      if (syncKey !== process.env.SESSION_SECRET) {
        return res.status(403).json({ error: "Forbidden" });
      }

      const { strategyConfigs: configs, strategyPlans: plans, brokerConfigs: brokers } = req.body;
      const results: any = { configs: [], plans: [], brokers: [] };
      const { db: database } = await import("../db");
      const schema = await import("@shared/schema");

      if (brokers && Array.isArray(brokers)) {
        for (const broker of brokers) {
          const existing = await storage.getBrokerConfig(broker.id);
          if (!existing) {
            const [inserted] = await database.insert(schema.brokerConfigs).values(broker).returning();
            results.brokers.push({ id: inserted.id, action: "inserted" });
          } else {
            results.brokers.push({ id: broker.id, action: "already_exists" });
          }
        }
      }

      if (configs && Array.isArray(configs)) {
        for (const config of configs) {
          const existing = await storage.getStrategyConfig(config.id);
          if (!existing) {
            const [inserted] = await database.insert(schema.strategyConfigs).values(config).returning();
            results.configs.push({ id: inserted.id, action: "inserted" });
          } else {
            results.configs.push({ id: config.id, action: "already_exists" });
          }
        }
      }

      if (plans && Array.isArray(plans)) {
        for (const plan of plans) {
          const existing = await storage.getStrategyPlan(plan.id);
          if (!existing) {
            const [inserted] = await database.insert(schema.strategyPlans).values(plan).returning();
            results.plans.push({ id: inserted.id, action: "inserted" });
          } else {
            results.plans.push({ id: plan.id, action: "already_exists" });
          }
        }
      }

      res.json({ success: true, results });
    } catch (error: any) {
      console.error("Sync data error:", error);
      res.status(500).json({ error: error.message });
    }
  });
}
