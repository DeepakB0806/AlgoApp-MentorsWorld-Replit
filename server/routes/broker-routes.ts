import type { Express } from "express";
import type { IStorage } from "../storage";
import { insertBrokerConfigSchema, webhookStatusLogs, brokerTestLogs, brokerSessionLogs } from "@shared/schema";
import { tradingCache } from "../cache";
import { db } from "../db";
import { desc, eq, sql, or } from "drizzle-orm";
import EL from "../el-kotak-neo-v3";
import { startPersistentSquareOff } from "../te-kotak-neo-v3";
import { addProcessFlowLog, getProcessFlowLogs, getProcessFlowPlans } from "../process-flow-log";
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

      if (result.success && updated) {
        setImmediate(async () => {
          try {
            const { runScripMasterSync } = await import("../scrip-master-sync");
            const syncResult = await runScripMasterSync(storage, updated);
            console.log(`[BROKER-AUTH] Post-login scrip master sync: ${syncResult.success ? `${syncResult.synced} instruments synced` : syncResult.error}`);
          } catch (err: any) {
            console.error(`[BROKER-AUTH] Post-login scrip master sync error: ${err.message}`);
          }
        });
      }
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
      if (deploymentStatus === "squared_off") {
        const now = new Date().toISOString();
        let usedBroker = false;
        if (plan.brokerConfigId) {
          const brokerConfig = await storage.getBrokerConfig(plan.brokerConfigId);
          if (brokerConfig) {
            usedBroker = true;
            startPersistentSquareOff(storage, id, brokerConfig);
            console.log(`[ROUTE] Persistent square-off started for plan ${id}`);
          }
        }
        if (!usedBroker) {
          const openTrades = await storage.getOpenTradesByPlan(id);
          for (const trade of openTrades) {
            const entryPrice = trade.price || 0;
            const currentPrice = trade.ltp || entryPrice;
            const qty = trade.quantity || 1;
            const pnl = trade.action === "BUY"
              ? (currentPrice - entryPrice) * qty
              : (entryPrice - currentPrice) * qty;
            const roundedPnl = Math.round(pnl * 100) / 100;
            await storage.updateStrategyTrade(trade.id, {
              status: "closed",
              pnl: roundedPnl,
              ltp: currentPrice,
              exitPrice: currentPrice,
              exitAction: trade.action === "BUY" ? "SELL" : "BUY",
              exitedAt: now,
              updatedAt: now,
            });
            addProcessFlowLog({
              planId: id,
              planName: plan.name,
              signalType: "square_off",
              alert: "Square off all positions (paper)",
              resolvedAction: "CLOSE",
              blockType: "square_off",
              actionTaken: "squared_off",
              message: `Paper squared off trade: ${trade.tradingSymbol} qty=${trade.quantity} exitPrice=${currentPrice} pnl=${roundedPnl}`,
              broker: "paper_trade",
              ticker: trade.tradingSymbol || undefined,
              exchange: trade.exchange || undefined,
              price: currentPrice,
            });
          }
          tradingCache.invalidateOpenTrades(id);
        }
      }
      if (deploymentStatus === "active") {
        updateData.awaitingCleanEntry = true;
      }
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
          const normalized = (result.data as any[]).map((p: any) => {
            const buyQty  = Number(p.flBuyQty  || p.buyQuantity  || p.buyQty  || 0);
            const sellQty = Number(p.flSellQty || p.sellQuantity || p.sellQty || 0);
            const buyAmt  = Number(p.buyAmt  || p.buyAmount  || 0);
            const sellAmt = Number(p.sellAmt || p.sellAmount || 0);

            const quantity = Number(p.qty || p.quantity || 0);
            const buyAvg  = buyQty  > 0 ? buyAmt  / buyQty  : Number(p.upldPrc || p.uploadPrice || p.buy_avg  || 0);
            const sellAvg = sellQty > 0 ? sellAmt / sellQty : Number(p.sell_avg || 0);

            const kotakLtp  = Number(p.ltp || p.lastTradedPrice || 0);
            const kotakPnl  = Number(p.pnl || p.mtmPnl || p.mtm || 0);
            const kotakRpnl = Number(p.rpnl || p.realisedPnl || p.realised_pnl || 0);
            const unrealisedPnl = p.urmtom !== undefined
              ? Number(p.urmtom)
              : (p.unrealisedPnl !== undefined ? Number(p.unrealisedPnl) : undefined);

            // When Kotak does not supply rpnl/pnl/ltp for net-zero (qty=0) positions,
            // compute them from amounts that Kotak does supply correctly.
            const amountsKnown  = buyAmt > 0 && sellAmt > 0;
            const computedRpnl  = amountsKnown ? sellAmt - buyAmt : 0;
            const realisedPnl   = kotakRpnl !== 0 ? kotakRpnl : computedRpnl;
            const totalPnl      = kotakPnl  !== 0 ? kotakPnl  : realisedPnl + (unrealisedPnl ?? 0);
            // For closed positions (qty=0) where Kotak returns ltp=0, show the last execution price.
            const ltp = kotakLtp !== 0 ? kotakLtp : (quantity === 0 ? (sellAvg || buyAvg) : 0);

            return {
              trading_symbol: p.trdSym || p.tradingSymbol || p.trading_symbol || p.symbol || "",
              exchange: p.exSeg || p.exchange || "",
              product_type: p.prod || p.productType || p.product_type || "NRML",
              quantity,
              buy_avg: buyAvg,
              sell_avg: sellAvg,
              ltp,
              option_type: p.optTp || p.optionType || p.option_type || null,
              strike_price: p.stkPrc || p.strikePrice || p.strike_price || null,
              expiry: p.expDt || p.expiryDisplay || p.expiry || p.exp || null,
              pnl: totalPnl,
              realised_pnl: realisedPnl,
              unrealised_pnl: unrealisedPnl,
              instrument_type: p.type || p.instType || "",
              token: p.tok || p.tknNo || "",
            };
          });
          return res.json(normalized);
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
          const normalized = (result.data as any[]).map((o: any) => ({
            order_id: o.orderNo || o.order_id || o.nOrdNo || o.ordNo || "",
            trading_symbol: o.tradingSymbol || o.trading_symbol || o.trdSym || o.ts || "",
            exchange: o.exchange || o.exSeg || o.es || "",
            transaction_type: o.transactionType || o.transaction_type || o.tt || "",
            order_type: o.priceType || o.order_type || o.pt || o.orderType || "",
            quantity: Number(o.quantity || o.qt || 0),
            price: Number(o.avgPrc || o.prc || o.price || o.pr || 0),
            status: o.status || o.stat || o.ordSt || "",
            timestamp: o.timestamp || o.plDate || o.time || o.ordTm || "",
          }));
          return res.json(normalized);
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
          const normalized = (result.data as any[]).map((h: any) => ({
            trading_symbol: h.symbol || h.displaySymbol || h.trading_symbol || h.tradingSymbol || "",
            quantity: Number(h.quantity || 0),
            average_price: Number(h.averagePrice || h.average_price || 0),
            current_price: Number(h.ltp || h.closingPrice || h.current_price || 0),
            current_value: Number(h.marketValue || h.mktValue || h.current_value || 0),
            invested_value: Number(h.investedValue || h.holdingCost || h.invested_value || 0),
            pnl: Number(h.unrealisedPnl || h.pnl || 0),
            pnl_percent: Number(h.pnlPercent || h.pnl_percent || 0),
            today_pnl: Number(h.todayPnl || h.today_pnl || 0),
            today_pnl_percent: Number(h.todayPnlPercent || h.today_pnl_percent || 0),
            prev_close: Number(h.prevDayLtp || h.prev_close || 0),
          }));
          return res.json(normalized);
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

  const scripSyncInProgress = new Set<string>();

  app.get("/api/te/readiness/:brokerConfigId", async (req, res) => {
    try {
      const { brokerConfigId } = req.params;
      const brokerConfig = await storage.getBrokerConfig(brokerConfigId);
      if (!brokerConfig) {
        return res.status(404).json({ ready: false, instrumentCount: 0, error: "Broker config not found", stale: false, lastUpdated: null, syncing: false });
      }

      if (brokerConfig.brokerName !== "kotak_neo") {
        return res.json({ ready: true, instrumentCount: 0, error: null, stale: false, lastUpdated: null, syncing: false });
      }

      const instrumentConfigs = await storage.getInstrumentConfigs();
      const nfoConfigs = instrumentConfigs.filter(ic => ic.exchange === "NFO");

      if (nfoConfigs.length === 0) {
        const syncing = scripSyncInProgress.has(brokerConfigId);
        if (!syncing && brokerConfig.isConnected && brokerConfig.accessToken) {
          scripSyncInProgress.add(brokerConfigId);
          setImmediate(async () => {
            try {
              const { runScripMasterSync } = await import("../scrip-master-sync");
              const result = await runScripMasterSync(storage, brokerConfig);
              console.log(`[TE-READINESS] Auto-sync (no data): ${result.success ? `${result.synced} instruments` : result.error}`);
            } catch (err: any) {
              console.error(`[TE-READINESS] Auto-sync error: ${err.message}`);
            } finally {
              scripSyncInProgress.delete(brokerConfigId);
            }
          });
        }
        return res.json({
          ready: false,
          instrumentCount: 0,
          error: syncing ? "Syncing scrip master..." : "Scrip master file not downloaded — login with TOTP to sync",
          stale: false,
          lastUpdated: null,
          syncing: syncing || scripSyncInProgress.has(brokerConfigId),
        });
      }

      const lastUpdated = nfoConfigs.reduce((latest, ic) => {
        const d = ic.updatedAt ? new Date(ic.updatedAt).getTime() : 0;
        return d > latest ? d : latest;
      }, 0);

      const toISTDate = (date: Date) => {
        const istOffset = 5.5 * 60 * 60 * 1000;
        const istTime = new Date(date.getTime() + istOffset);
        return istTime.toISOString().slice(0, 10);
      };
      const todayIST = toISTDate(new Date());
      const lastUpdatedDateIST = lastUpdated > 0 ? toISTDate(new Date(lastUpdated)) : null;

      const stale = lastUpdatedDateIST !== todayIST;
      const syncing = scripSyncInProgress.has(brokerConfigId);

      if (stale && !syncing && brokerConfig.isConnected && brokerConfig.accessToken) {
        scripSyncInProgress.add(brokerConfigId);
        setImmediate(async () => {
          try {
            const { runScripMasterSync } = await import("../scrip-master-sync");
            const result = await runScripMasterSync(storage, brokerConfig);
            console.log(`[TE-READINESS] Auto-sync (stale data): ${result.success ? `${result.synced} instruments` : result.error}`);
          } catch (err: any) {
            console.error(`[TE-READINESS] Auto-sync error: ${err.message}`);
          } finally {
            scripSyncInProgress.delete(brokerConfigId);
          }
        });
      }

      return res.json({
        ready: true,
        instrumentCount: nfoConfigs.length,
        error: null,
        stale,
        lastUpdated: lastUpdated > 0 ? new Date(lastUpdated).toISOString() : null,
        syncing: syncing || scripSyncInProgress.has(brokerConfigId),
      });
    } catch (error) {
      res.status(500).json({ ready: false, instrumentCount: 0, error: "Failed to check trade readiness", stale: false, lastUpdated: null, syncing: false });
    }
  });

  const KOTAK_ERROR_CODES: Record<string, string> = {
    "1005": "Internal Error",
    "1006": "Invalid Exchange",
    "1007": "Invalid Symbol",
    "1009": "Invalid Quantity",
    "1004": "Insufficient Balance",
    "400": "Bad Request Format",
    "401": "Session Expired / Unauthorized",
    "424": "Dependency Failure",
  };

  function enrichErrorMessage(msg: string | null): string {
    if (!msg) return "";
    const codeMatch = msg.match(/\b(1004|1005|1006|1007|1009|400|401|424)\b/);
    if (codeMatch && KOTAK_ERROR_CODES[codeMatch[1]]) {
      return `${msg} [Kotak: ${KOTAK_ERROR_CODES[codeMatch[1]]}]`;
    }
    return msg;
  }

  app.get("/api/error-logs", async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
      const category = (req.query.category as string) || "all";

      type ErrorLogEntry = {
        id: string;
        timestamp: string;
        source: string;
        category: string;
        message: string;
        details: string;
      };

      const errors: ErrorLogEntry[] = [];

      if (category === "all" || category === "webhook") {
        const webhookErrors = await db.select()
          .from(webhookStatusLogs)
          .where(eq(webhookStatusLogs.status, "failed"))
          .orderBy(desc(webhookStatusLogs.testedAt))
          .limit(limit);

        for (const log of webhookErrors) {
          errors.push({
            id: `wh-${log.id}`,
            timestamp: log.testedAt,
            source: `Webhook ${log.webhookId?.slice(0, 8) || "unknown"}`,
            category: "webhook",
            message: enrichErrorMessage(log.errorMessage || log.responseMessage || "Webhook test failed"),
            details: [
              log.statusCode ? `HTTP ${log.statusCode}` : null,
              log.responseTime ? `${log.responseTime}ms` : null,
              log.responseMessage,
            ].filter(Boolean).join(" | "),
          });
        }
      }

      if (category === "all" || category === "broker_test") {
        const testErrors = await db.select()
          .from(brokerTestLogs)
          .where(eq(brokerTestLogs.status, "failed"))
          .orderBy(desc(brokerTestLogs.testedAt))
          .limit(limit);

        for (const log of testErrors) {
          errors.push({
            id: `bt-${log.id}`,
            timestamp: log.testedAt,
            source: `Broker Test ${log.brokerConfigId?.slice(0, 8) || "unknown"}`,
            category: "broker_test",
            message: enrichErrorMessage(log.errorMessage || log.message || "Connection test failed"),
            details: [
              log.responseTime ? `${log.responseTime}ms` : null,
              log.message,
            ].filter(Boolean).join(" | "),
          });
        }
      }

      if (category === "all" || category === "broker_session") {
        const sessionErrors = await db.select()
          .from(brokerSessionLogs)
          .where(eq(brokerSessionLogs.status, "failed"))
          .orderBy(desc(brokerSessionLogs.loginAt))
          .limit(limit);

        for (const log of sessionErrors) {
          errors.push({
            id: `bs-${log.id}`,
            timestamp: log.loginAt,
            source: `Session ${log.brokerConfigId?.slice(0, 8) || "unknown"}`,
            category: "broker_session",
            message: enrichErrorMessage(log.errorMessage || log.message || "Authentication failed"),
            details: [
              log.totpUsed ? `TOTP: ****` : null,
              log.message,
            ].filter(Boolean).join(" | "),
          });
        }
      }

      errors.sort((a, b) => {
        const da = new Date(a.timestamp).getTime() || 0;
        const db2 = new Date(b.timestamp).getTime() || 0;
        return db2 - da;
      });

      res.json({
        errors: errors.slice(0, limit),
        total: errors.length,
        kotakErrorCodes: KOTAK_ERROR_CODES,
      });
    } catch (error) {
      console.error("[ERROR-LOGS] Failed to fetch error logs:", error);
      res.status(500).json({ error: "Failed to fetch error logs" });
    }
  });

  app.get("/api/process-flow-logs", (_req, res) => {
    const planId = _req.query.planId as string | undefined;
    const limit = parseInt(_req.query.limit as string) || 100;
    const { entries, totalCount } = getProcessFlowLogs(planId || undefined, limit);
    const plans = getProcessFlowPlans();
    res.json({ logs: entries, plans, total: totalCount });
  });

  app.get("/api/process-flow-logs/:planId", (req, res) => {
    const limit = parseInt(req.query.limit as string) || 100;
    const { entries, totalCount } = getProcessFlowLogs(req.params.planId, limit);
    const plans = getProcessFlowPlans();
    res.json({ logs: entries, plans, total: totalCount });
  });

  app.get("/api/broker-configs/:id/scrip-master-download", async (req, res) => {
    try {
      const brokerConfig = await storage.getBrokerConfig(req.params.id);
      if (!brokerConfig) return res.status(404).json({ error: "Broker config not found" });
      if (brokerConfig.brokerName !== "kotak_neo") {
        return res.status(400).json({ error: "Scrip master download is only available for Kotak Neo brokers" });
      }
      if (!brokerConfig.isConnected || !brokerConfig.accessToken) {
        return res.status(401).json({ error: "Broker not connected. Please login first." });
      }

      const { default: EL } = await import("../el-kotak-neo-v3");
      const filePathsResult = await EL.getScripMasterFilePaths(brokerConfig);
      if (!filePathsResult.success) {
        return res.status(502).json({ error: filePathsResult.error || "Failed to get scrip master file paths from broker" });
      }

      const data = filePathsResult.data;
      let nfoFileUrl: string | null = null;

      if (Array.isArray(data)) {
        for (const item of data) {
          const path = item.filePath || item.path || item.url || item.fileUrl || "";
          const name = item.fileName || item.name || item.exchange || "";
          if (path && (name.toLowerCase().includes("nfo") || name.toLowerCase().includes("nse_fo") || path.toLowerCase().includes("nfo") || path.toLowerCase().includes("nse_fo"))) {
            nfoFileUrl = path;
            break;
          }
        }
        if (!nfoFileUrl && data.length > 0) {
          for (const item of data) {
            const path = item.filePath || item.path || item.url || item.fileUrl || "";
            if (path) { nfoFileUrl = path; break; }
          }
        }
      } else if (data && typeof data === "object") {
        const filesPaths = (data as any).filesPaths || (data as any).data?.filesPaths;
        if (filesPaths && Array.isArray(filesPaths)) {
          for (const item of filesPaths) {
            const path = typeof item === "string" ? item : (item.filePath || item.path || item.url || "");
            const name = typeof item === "string" ? item : (item.fileName || item.name || item.exchange || "");
            if (path && (name.toLowerCase().includes("nfo") || name.toLowerCase().includes("nse_fo") || path.toLowerCase().includes("nfo") || path.toLowerCase().includes("nse_fo"))) {
              nfoFileUrl = path;
              break;
            }
          }
        }
      }

      if (!nfoFileUrl) {
        return res.status(404).json({ error: "Could not find NFO scrip master file URL in broker response" });
      }

      try {
        const parsed = new URL(nfoFileUrl);
        if (parsed.protocol !== "https:") {
          return res.status(400).json({ error: "Scrip master URL must use HTTPS" });
        }
        const host = parsed.hostname.toLowerCase();
        if (!host.endsWith("kotaksecurities.com") && !host.endsWith("kotak.com") && !host.endsWith("neo.kotak.com")) {
          return res.status(400).json({ error: `Untrusted scrip master host: ${host}` });
        }
      } catch {
        return res.status(400).json({ error: "Invalid scrip master URL" });
      }

      const csvResponse = await fetch(nfoFileUrl, { signal: AbortSignal.timeout(180000) });
      if (!csvResponse.ok) {
        return res.status(502).json({ error: `CSV download failed: ${csvResponse.status} ${csvResponse.statusText}` });
      }

      const csvText = await csvResponse.text();
      const now = new Date();
      const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      const filename = `scrip_master_nfo_${dateStr}.csv`;

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("Content-Length", Buffer.byteLength(csvText, "utf-8"));
      res.send(csvText);
    } catch (error: any) {
      console.error(`[BROKER] Scrip master download error:`, error.message);
      res.status(500).json({ error: error.message || "Scrip master download failed" });
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
