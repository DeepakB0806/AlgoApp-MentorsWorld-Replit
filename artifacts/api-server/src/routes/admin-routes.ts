import type { Express } from "express";
import type { IStorage } from "../storage";
import { sendEmail } from "../services/email";
import { rescheduleScripMasterSync } from "../scrip-sync-scheduler";
import { insertErrorRoutingSchema } from "@workspace/db";
import { resetTradingHaltCache } from "./webhook-routes";
import { getHsiStatus, getHsiHistory, forceReconnect as forceHsiReconnect } from "../hsi-kotak-neo-v3";
import { getHsmStatus, getHsmHistory, forceReconnect as forceHsmReconnect } from "../hsm-kotak-neo-v3";
import { runProbe, runProbeForBoth, getLastProbeResults } from "../kotak-probe";

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
      if (req.params.key === "margin_calc_time") {
        import("../cm-kotak-neo-v3").then(m =>
          m.scheduleMarginCalc(storage).catch(err =>
            console.error(`[MARGIN-SCHED] Failed to reschedule after settings save: ${err}`)
          )
        );
      }
      if (req.params.key === "fit_check_time") {
        import("../cm-kotak-neo-v3").then(m =>
          m.scheduleFitCheck(storage).catch(err =>
            console.error(`[FIT-CHECK] Failed to reschedule after settings save: ${err}`)
          )
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
      const schema = await import("@workspace/db");

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

  // ── Error Routing CRUD ────────────────────────────────────────────────────

  app.get("/api/error-routes", async (req, res) => {
    try {
      const routes = await storage.getAllErrorRoutes();
      res.json(routes);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch error routes" });
    }
  });

  app.post("/api/error-routes", async (req, res) => {
    try {
      const parsed = insertErrorRoutingSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
      const route = await storage.createErrorRoute(parsed.data);
      res.status(201).json(route);
    } catch (error: any) {
      if (error.message?.includes("unique")) {
        return res.status(409).json({ error: "Error pattern already exists" });
      }
      res.status(500).json({ error: "Failed to create error route" });
    }
  });

  app.patch("/api/error-routes/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
      const route = await storage.updateErrorRoute(id, req.body);
      if (!route) return res.status(404).json({ error: "Route not found" });
      res.json(route);
    } catch (error) {
      res.status(500).json({ error: "Failed to update error route" });
    }
  });

  app.delete("/api/error-routes/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
      const deleted = await storage.deleteErrorRoute(id);
      if (!deleted) return res.status(404).json({ error: "Route not found" });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete error route" });
    }
  });

  app.post("/api/settings/resume-trading", async (req, res) => {
    try {
      await storage.setSetting("trading_halted", "false");
      resetTradingHaltCache();
      res.json({ success: true, message: "Trading Resumed" });
    } catch (error) {
      res.status(500).json({ error: "Failed to resume trading" });
    }
  });

  app.get("/api/admin/hsi/status", (_req, res) => {
    try {
      res.json(getHsiStatus());
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/admin/hsi/reconnect", (_req, res) => {
    try {
      const result = forceHsiReconnect();
      res.status(result.ok ? 200 : 400).json(result);
    } catch (error: any) {
      res.status(500).json({ ok: false, message: error.message });
    }
  });

  app.get("/api/admin/hsi/history", (_req, res) => {
    try {
      res.json(getHsiHistory());
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/admin/hsm/status", (_req, res) => {
    try {
      res.json(getHsmStatus());
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/admin/hsm/reconnect", (_req, res) => {
    try {
      const result = forceHsmReconnect();
      res.status(result.ok ? 200 : 400).json(result);
    } catch (error: any) {
      res.status(500).json({ ok: false, message: error.message });
    }
  });

  app.get("/api/admin/hsm/history", (_req, res) => {
    try {
      res.json(getHsmHistory());
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ── Kotak Probe & Test Harness ─────────────────────────────────────────────

  app.get("/api/admin/broker-credentials/active", async (_req, res) => {
    try {
      const configs = await storage.getBrokerConfigs();
      const active = configs.find(c => c.brokerName === "kotak_neo" && c.isConnected);
      if (!active) return res.status(404).json({ error: "No connected Kotak Neo broker found" });
      res.json({
        accessToken: active.accessToken ?? null,
        sessionId: active.sessionId ?? null,
        dataCenter: active.dataCenter ?? null,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/admin/probe/run", async (req, res) => {
    try {
      const configs = await storage.getBrokerConfigs();
      const active = configs.find(c => c.brokerName === "kotak_neo" && c.isConnected);
      if (!active) return res.status(404).json({ error: "No connected Kotak Neo broker found" });
      const target: string = req.body?.target ?? "both";
      if (target === "both") {
        const results = await runProbeForBoth(active);
        res.json(results);
      } else if (target === "hsi" || target === "hsm") {
        const result = await runProbe(active, target);
        res.json(result);
      } else {
        res.status(400).json({ error: "target must be hsm, hsi, or both" });
      }
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/admin/probe/status", (_req, res) => {
    try {
      res.json(getLastProbeResults());
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ── Daily Strategy Fit Log (#247) ──────────────────────────────────────────
  app.get("/api/admin/fit-log", async (req, res) => {
    try {
      const todayIST = new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const date = typeof req.query.date === "string" ? req.query.date : todayIST;
      const ucc = typeof req.query.ucc === "string" ? req.query.ucc : undefined;
      const rows = ucc
        ? await storage.getDailyStrategyFitByUcc(ucc, date)
        : await storage.getDailyStrategyFitByDate(date);
      res.json(rows);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch fit log" });
    }
  });
}
