import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertStrategySchema, insertWebhookSchema, insertBrokerConfigSchema } from "@shared/schema";
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
  async function getAuthenticatedSession(): Promise<{ session: KotakNeoSession; consumerKey: string } | null> {
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
        if (result.success && result.data) {
          // Transform Kotak Neo response to our format
          const holdings = (result.data as unknown[]).map((hld: unknown) => {
            const h = hld as Record<string, unknown>;
            const qty = Number(h.holdQty || h.quantity || 0);
            const avgPrice = Number(h.avgPrc || h.averagePrice || 0);
            const currentPrice = Number(h.ltp || h.currentPrice || avgPrice);
            const pnl = (currentPrice - avgPrice) * qty;
            const pnlPercent = avgPrice > 0 ? ((currentPrice - avgPrice) / avgPrice) * 100 : 0;
            
            return {
              trading_symbol: String(h.trdSym || h.tradingSymbol || ""),
              quantity: qty,
              average_price: avgPrice,
              current_price: currentPrice,
              pnl: pnl,
              pnl_percent: pnlPercent,
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
