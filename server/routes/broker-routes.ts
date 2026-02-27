import type { Express } from "express";
import type { IStorage } from "../storage";
import { insertBrokerConfigSchema } from "@shared/schema";
import { tradingCache } from "../cache";
import EL from "../el-kotak-neo-v3";
import {
  testBinanceConnectivity,
  authenticateBinance,
  getPositions as getBinancePositions,
  getOrderBook as getBinanceOrders,
  getHoldings as getBinanceHoldings,
  getAccountBalance as getBinanceBalance,
  getProxyStatus as getBinanceProxyStatus,
  type BinanceSession
} from "../binance-api";

function getBinanceSessionFromConfig(config: { consumerKey: string | null; consumerSecret: string | null; environment: string | null }): BinanceSession | null {
  if (!config.consumerKey || !config.consumerSecret) return null;
  return {
    apiKey: config.consumerKey,
    apiSecret: config.consumerSecret,
    isTestnet: config.environment !== "prod",
  };
}

export function registerBrokerRoutes(app: Express, storage: IStorage) {
  app.get("/api/binance/proxy-status", async (_req, res) => {
    res.json(getBinanceProxyStatus());
  });

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
      tradingCache.invalidateBrokerConfig(req.params.id);
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

      let result: { success: boolean; message?: string; error?: string };

      if (config.brokerName === "paper_trade") {
        result = { success: true, message: "Paper Trade engine is ready — no external connection needed" };
      } else if (config.brokerName === "kotak_neo") {
        if (!config.consumerKey) {
          return res.status(400).json({ 
            success: false, 
            error: "Consumer Key (API Token) is required for Kotak Neo" 
          });
        }
        result = await EL.testConnectivity(config.consumerKey);
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
          errorMessage: typeof result.error === 'object' ? JSON.stringify(result.error) : (result.error || null),
          responseTime,
          testedAt: now,
        });

        return res.json({ 
          success: result.success, 
          message: result.message,
          error: typeof result.error === 'object' ? JSON.stringify(result.error) : (result.error || null),
          config: updated 
        });
      }

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
          errorMessage: typeof result.error === 'object' ? JSON.stringify(result.error) : (result.error || null),
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
          error: typeof result.error === 'object' ? JSON.stringify(result.error) : (result.error || null),
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

      const result = await EL.authenticate(config, totp);

      let sessionExpiry: string | null = null;
      if (result.success && result.data?.sessionToken) {
        try {
          const parts = result.data.sessionToken.split('.');
          if (parts.length === 3) {
            const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
            if (payload.exp) {
              sessionExpiry = new Date(payload.exp * 1000).toISOString().replace('T', ' ').slice(0, 19);
            }
          }
        } catch {
        }
      }

      const updated = await storage.updateBrokerConfig(req.params.id, {
        isConnected: result.success,
        lastConnected: result.success ? now : config.lastConnected,
        connectionError: result.success ? null : result.error,
        accessToken: result.data?.sessionToken || null,
        sessionId: result.data?.sidSession || null,
        baseUrl: result.data?.baseUrl || null,
        viewToken: result.data?.viewToken || null,
        sidView: result.data?.sidView || null,
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
        errorMessage: typeof result.error === 'object' ? JSON.stringify(result.error) : (result.error || null),
        totpUsed: totp,
        accessToken: result.data?.sessionToken || null,
        sessionId: result.data?.sidSession || null,
        baseUrl: result.data?.baseUrl || null,
        sessionExpiry,
        loginAt: now,
      });

      res.json({ 
        success: result.success, 
        message: result.message,
        error: typeof result.error === 'object' ? JSON.stringify(result.error) : (result.error || null),
        sessionExpiry,
        config: updated 
      });
    } catch (error) {
      res.status(500).json({ error: "Authentication failed", details: error instanceof Error ? error.message : "Unknown error" });
    }
  });

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

      const result = await EL.getPositions(brokerConfig);
      return res.json(result.success && result.data ? result.data : []);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch positions for broker config" });
    }
  });

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
      if (updated?.configId) tradingCache.invalidatePlans(updated.configId);
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: "Failed to update deployment status" });
    }
  });

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

  app.delete("/api/strategy-trades/:planId/clear", async (req, res) => {
    try {
      const { planId } = req.params;
      const days = req.query.days;
      let deletedCount: number;
      if (days && days !== "all") {
        deletedCount = await storage.deleteStrategyTradesByPlan(planId, parseInt(days as string));
      } else {
        deletedCount = await storage.deleteAllStrategyTradesByPlan(planId);
      }
      res.json({ success: true, deletedCount });
    } catch (error) {
      res.status(500).json({ error: "Failed to clear strategy trades" });
    }
  });

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

  app.delete("/api/strategy-daily-pnl/:planId/clear", async (req, res) => {
    try {
      const { planId } = req.params;
      const { days } = req.query;
      let deleted = 0;
      if (days === "all") {
        deleted = await storage.deleteAllStrategyDailyPnlByPlan(planId);
      } else {
        const daysNum = parseInt(days as string, 10);
        if (isNaN(daysNum) || daysNum < 1) {
          return res.status(400).json({ error: "Invalid days parameter" });
        }
        deleted = await storage.deleteStrategyDailyPnlByPlan(planId, daysNum);
      }
      res.json({ deleted });
    } catch (error) {
      res.status(500).json({ error: "Failed to clear daily P&L data" });
    }
  });

  app.get("/api/positions", async (req, res) => {
    try {
      const kotakConfig = await findConnectedKotak(storage);
      
      if (kotakConfig) {
        const result = await EL.getPositions(kotakConfig);
        if (result.success && result.data) {
          return res.json(result.data);
        }
      }
      
      const positions = await storage.getPositions();
      res.json(positions);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch positions" });
    }
  });

  app.get("/api/orders", async (req, res) => {
    try {
      const kotakConfig = await findConnectedKotak(storage);
      
      if (kotakConfig) {
        const result = await EL.getOrderBook(kotakConfig);
        if (result.success && result.data) {
          return res.json(result.data);
        }
      }
      
      const orders = await storage.getOrders();
      res.json(orders);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch orders" });
    }
  });

  app.get("/api/holdings", async (req, res) => {
    try {
      const kotakConfig = await findConnectedKotak(storage);
      
      if (kotakConfig) {
        const result = await EL.getHoldings(kotakConfig);
        
        if (result.sessionExpired) {
          console.log("Session expired, clearing tokens for broker:", kotakConfig.id);
          await storage.updateBrokerConfig(kotakConfig.id, {
            accessToken: null,
            sessionId: null,
            baseUrl: null,
            isConnected: false,
          });
        }
        
        if (result.success && result.data && Array.isArray(result.data) && result.data.length > 0) {
          return res.json(result.data);
        }
      }
      
      const holdings = await storage.getHoldings();
      res.json(holdings);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch holdings" });
    }
  });

  app.get("/api/portfolio-summary", async (req, res) => {
    try {
      const kotakConfig = await findConnectedKotak(storage);
      
      if (kotakConfig) {
        const [limitsResult, holdingsResult, positionsResult] = await Promise.all([
          EL.getLimits(kotakConfig),
          EL.getHoldings(kotakConfig),
          EL.getPositions(kotakConfig),
        ]);
        
        let totalValue = 0;
        let dayPnL = 0;
        let totalPnL = 0;
        let availableMargin = 0;
        
        if (holdingsResult.success && holdingsResult.data) {
          (holdingsResult.data as any[]).forEach((h: any) => {
            totalValue += Number(h.mktValue || h.marketValue || 0);
            totalPnL += Number(h.unrealisedGainLoss || h.unrealizedPnl || 0);
          });
        }
        
        if (positionsResult.success && positionsResult.data) {
          (positionsResult.data as any[]).forEach((p: any) => {
            dayPnL += Number(p.mtm || p.markToMarket || 0);
          });
        }
        
        if (limitsResult.success && limitsResult.data) {
          const limits = limitsResult.data as Record<string, unknown>;
          availableMargin = Number(limits.marginAvailable || limits.cash || limits.Net || 0);
          if (totalValue === 0) {
            totalValue = availableMargin;
          }
        }
        
        return res.json({ totalValue, dayPnL, totalPnL, availableMargin });
      }
      
      const summary = await storage.getPortfolioSummary();
      res.json(summary);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch portfolio summary" });
    }
  });

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

  app.get("/api/broker-session-status", async (req, res) => {
    try {
      const configs = await storage.getBrokerConfigs();
      const connectedBrokers = configs
        .filter(c => c.isConnected)
        .map(c => ({ id: c.id, broker: c.brokerName, name: c.name, environment: c.environment }));

      const kotakConfig = await findConnectedKotak(storage);
      res.json({
        isAuthenticated: !!kotakConfig || connectedBrokers.length > 0,
        broker: kotakConfig ? "kotak_neo" : (connectedBrokers.length > 0 ? connectedBrokers[0].broker : null),
        connectedBrokers,
      });
    } catch (error) {
      res.json({ isAuthenticated: false, broker: null, connectedBrokers: [] });
    }
  });
}

async function findConnectedKotak(storage: IStorage) {
  const configs = await storage.getBrokerConfigs();
  return configs.find(c => 
    c.brokerName === "kotak_neo" && 
    c.isConnected && 
    c.accessToken && 
    c.sessionId && 
    c.baseUrl
  ) || null;
}
