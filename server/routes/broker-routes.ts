import type { Express } from "express";
import type { IStorage } from "../storage";
import { insertBrokerConfigSchema } from "@shared/schema";
import { tradingCache } from "../cache";
import { 
  testKotakNeoConnectivity, 
  authenticateKotakNeo,
  getPositions as getKotakPositions,
  getOrderBook as getKotakOrders,
  getHoldings as getKotakHoldings,
  getLimits as getKotakLimits,
  type KotakNeoSession
} from "../kotak-neo-api";
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

async function getAuthenticatedSession(storage: IStorage): Promise<{ session: KotakNeoSession; consumerKey: string; brokerId: string } | null> {
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
      viewToken: "",
      sidView: "",
      sessionToken: kotakConfig.accessToken,
      sidSession: kotakConfig.sessionId,
      baseUrl: kotakConfig.baseUrl,
    },
    consumerKey: kotakConfig.consumerKey,
    brokerId: kotakConfig.id,
  };
}

async function getAuthenticatedSessionByConfigId(storage: IStorage, configId: string): Promise<{ session: KotakNeoSession; consumerKey: string; brokerId: string } | null> {
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

      const auth = await getAuthenticatedSessionByConfigId(storage, brokerConfigId);
      if (!auth) {
        return res.status(400).json({ error: "Broker not connected or session expired" });
      }
      const result = await getKotakPositions(auth.session);
      if (result.success && result.data) {
        const positions = (result.data as unknown[]).map((pos: unknown) => {
          const p = pos as Record<string, unknown>;
          const buyQty = Number(p.flBuyQty || 0);
          const sellQty = Number(p.flSellQty || 0);
          const buyAmt = Number(p.buyAmt || 0);
          const sellAmt = Number(p.sellAmt || 0);
          return {
            trading_symbol: String(p.trdSym || ""),
            exchange: String(p.exSeg || ""),
            quantity: buyQty - sellQty,
            buy_qty: buyQty,
            sell_qty: sellQty,
            buy_avg: buyQty > 0 ? buyAmt / buyQty : 0,
            sell_avg: sellQty > 0 ? sellAmt / sellQty : 0,
            buy_amt: buyAmt,
            sell_amt: sellAmt,
            pnl: Number(p.mtm || 0),
            ltp: Number(p.ltp || 0),
            product_type: String(p.prod || ""),
            option_type: p.optTp ? String(p.optTp) : undefined,
            strike_price: p.stkPrc ? Number(p.stkPrc) : undefined,
            expiry: p.exDt ? String(p.exDt) : undefined,
            realised_pnl: Number(p.realisedprofitloss || 0),
            unrealised_pnl: Number(p.unrealisedprofitloss || 0),
            token: String(p.tok || ""),
          };
        });
        return res.json(positions);
      }
      res.json([]);
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
      const auth = await getAuthenticatedSession(storage);
      
      if (auth) {
        const result = await getKotakPositions(auth.session);
        if (result.success && result.data) {
          console.log("First Kotak position item:", JSON.stringify(result.data[0], null, 2));
          const positions = (result.data as unknown[]).map((pos: unknown) => {
            const p = pos as Record<string, unknown>;
            const buyQty = Number(p.flBuyQty || 0);
            const sellQty = Number(p.flSellQty || 0);
            const buyAmt = Number(p.buyAmt || 0);
            const sellAmt = Number(p.sellAmt || 0);
            
            return {
              trading_symbol: String(p.trdSym || ""),
              exchange: String(p.exSeg || ""),
              quantity: buyQty - sellQty,
              buy_qty: buyQty,
              sell_qty: sellQty,
              buy_avg: buyQty > 0 ? buyAmt / buyQty : 0,
              sell_avg: sellQty > 0 ? sellAmt / sellQty : 0,
              buy_amt: buyAmt,
              sell_amt: sellAmt,
              pnl: Number(p.mtm || 0),
              ltp: Number(p.ltp || 0),
              product_type: String(p.prod || ""),
              option_type: p.optTp ? String(p.optTp) : undefined,
              strike_price: p.stkPrc ? Number(p.stkPrc) : undefined,
              expiry: p.exDt ? String(p.exDt) : undefined,
              realised_pnl: Number(p.realisedprofitloss || 0),
              unrealised_pnl: Number(p.unrealisedprofitloss || 0),
              token: String(p.tok || ""),
            };
          });
          return res.json(positions);
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
      const auth = await getAuthenticatedSession(storage);
      
      if (auth) {
        const result = await getKotakOrders(auth.session);
        if (result.success && result.data) {
          console.log("First Kotak order item:", JSON.stringify(result.data[0], null, 2));
          const orders = (result.data as unknown[]).map((ord: unknown) => {
            const o = ord as Record<string, unknown>;
            return {
              order_id: String(o.nOrdNo || ""),
              trading_symbol: String(o.trdSym || ""),
              transaction_type: String(o.trnsTp || ""),
              quantity: Number(o.qty || 0),
              price: Number(o.prc || 0),
              status: String(o.ordSt || ""),
              order_type: String(o.prcTp || ""),
              exchange: String(o.exSeg || ""),
              timestamp: String(o.ordDtTm || ""),
            };
          });
          return res.json(orders);
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
      const auth = await getAuthenticatedSession(storage);
      
      if (auth) {
        const result = await getKotakHoldings(auth.session);
        
        if (result.sessionExpired) {
          console.log("Session expired, clearing tokens for broker:", auth.brokerId);
          await storage.updateBrokerConfig(auth.brokerId, {
            accessToken: null,
            sessionId: null,
            baseUrl: null,
            isConnected: false,
          });
        }
        
        if (result.success && result.data && Array.isArray(result.data) && result.data.length > 0) {
          console.log("First Kotak holding item:", JSON.stringify(result.data[0], null, 2));
          
          const holdings = (result.data as unknown[]).map((hld: unknown) => {
            const h = hld as Record<string, unknown>;
            const qty = Number(h.quantity || 0);
            const avgPrice = Number(h.averagePrice || 0);
            const prevClose = Number(h.closingPrice || 0);
            const mktValue = Number(h.mktValue || 0);
            const currentPrice = qty > 0 ? mktValue / qty : prevClose;
            const investedValue = Number(h.holdingCost || avgPrice * qty);
            const currentValue = mktValue;
            const pnl = Number(h.unrealisedGainLoss || 0);
            const pnlPercent = investedValue > 0 ? (pnl / investedValue) * 100 : 0;
            const todayPnl = prevClose > 0 ? (currentPrice - prevClose) * qty : 0;
            const todayPnlPercent = prevClose > 0 ? ((currentPrice - prevClose) / prevClose) * 100 : 0;
            
            return {
              trading_symbol: String(h.displaySymbol || ""),
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
      
      const holdings = await storage.getHoldings();
      res.json(holdings);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch holdings" });
    }
  });

  app.get("/api/portfolio-summary", async (req, res) => {
    try {
      const auth = await getAuthenticatedSession(storage);
      
      if (auth) {
        const limitsResult = await getKotakLimits(auth.session);
        const holdingsResult = await getKotakHoldings(auth.session);
        const positionsResult = await getKotakPositions(auth.session);
        
        let totalValue = 0;
        let dayPnL = 0;
        let totalPnL = 0;
        let availableMargin = 0;
        
        if (holdingsResult.success && holdingsResult.data) {
          (holdingsResult.data as unknown[]).forEach((h: unknown) => {
            const hld = h as Record<string, unknown>;
            totalValue += Number(hld.mktValue || 0);
            totalPnL += Number(hld.unrealisedGainLoss || 0);
          });
        }
        
        if (positionsResult.success && positionsResult.data) {
          (positionsResult.data as unknown[]).forEach((p: unknown) => {
            const pos = p as Record<string, unknown>;
            dayPnL += Number(pos.mtm || 0);
          });
        }
        
        if (limitsResult.success && limitsResult.data) {
          const limits = limitsResult.data as Record<string, unknown>;
          availableMargin = Number(limits.marginAvailable || limits.cash || limits.Net || 0);
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

      const auth = await getAuthenticatedSession(storage);
      res.json({
        isAuthenticated: !!auth || connectedBrokers.length > 0,
        broker: auth ? "kotak_neo" : (connectedBrokers.length > 0 ? connectedBrokers[0].broker : null),
        connectedBrokers,
      });
    } catch (error) {
      res.json({ isAuthenticated: false, broker: null, connectedBrokers: [] });
    }
  });
}
