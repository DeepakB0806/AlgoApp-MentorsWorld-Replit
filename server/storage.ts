import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { 
  strategies, webhooks, webhookLogs, brokerConfigs,
  type Strategy, type InsertStrategy,
  type Webhook, type InsertWebhook,
  type WebhookLog, type InsertWebhookLog,
  type BrokerConfig, type InsertBrokerConfig,
  type Position, type Order, type Holding, type PortfolioSummary
} from "@shared/schema";

export interface IStorage {
  // Strategies
  getStrategies(): Promise<Strategy[]>;
  getStrategy(id: string): Promise<Strategy | undefined>;
  createStrategy(strategy: InsertStrategy): Promise<Strategy>;
  updateStrategy(id: string, strategy: Partial<InsertStrategy>): Promise<Strategy | undefined>;
  deleteStrategy(id: string): Promise<boolean>;

  // Webhooks
  getWebhooks(): Promise<Webhook[]>;
  getWebhook(id: string): Promise<Webhook | undefined>;
  createWebhook(webhook: InsertWebhook): Promise<Webhook>;
  updateWebhook(id: string, webhook: Partial<InsertWebhook>): Promise<Webhook | undefined>;
  deleteWebhook(id: string): Promise<boolean>;

  // Webhook Logs
  getWebhookLogs(): Promise<WebhookLog[]>;
  createWebhookLog(log: InsertWebhookLog): Promise<WebhookLog>;

  // Broker Configs - persisted in database
  getBrokerConfigs(): Promise<BrokerConfig[]>;
  getBrokerConfig(id: string): Promise<BrokerConfig | undefined>;
  getBrokerConfigByUcc(ucc: string): Promise<BrokerConfig | undefined>;
  createBrokerConfig(config: InsertBrokerConfig): Promise<BrokerConfig>;
  updateBrokerConfig(id: string, config: Partial<InsertBrokerConfig>): Promise<BrokerConfig | undefined>;
  deleteBrokerConfig(id: string): Promise<boolean>;

  // Trading Data (fetched from broker or mock)
  getPositions(): Promise<Position[]>;
  getOrders(): Promise<Order[]>;
  getHoldings(): Promise<Holding[]>;
  getPortfolioSummary(): Promise<PortfolioSummary>;
}

// Database storage for persistent data (broker configs)
// Memory storage for transient data (strategies, webhooks, etc.)
export class DatabaseStorage implements IStorage {
  private strategiesMap: Map<string, Strategy>;
  private webhooksMap: Map<string, Webhook>;
  private webhookLogsMap: Map<string, WebhookLog>;

  constructor() {
    this.strategiesMap = new Map();
    this.webhooksMap = new Map();
    this.webhookLogsMap = new Map();
    this.initializeSampleData();
  }

  private initializeSampleData() {
    // Sample strategies
    const strategy1: Strategy = {
      id: randomUUID(),
      name: "NIFTY Momentum",
      description: "Momentum-based intraday strategy for NIFTY50",
      type: "intraday",
      status: "active",
      symbol: "NIFTY50",
      exchange: "NSE",
      quantity: 50,
      entryCondition: "RSI > 70 and price above 20 EMA",
      exitCondition: "RSI < 30 or target hit",
      stopLoss: 1.5,
      targetProfit: 3.0,
      totalTrades: 45,
      winningTrades: 28,
      profitLoss: 125000,
    };
    this.strategiesMap.set(strategy1.id, strategy1);

    const strategy2: Strategy = {
      id: randomUUID(),
      name: "Bank NIFTY Scalper",
      description: "Quick scalping strategy for Bank NIFTY",
      type: "scalping",
      status: "inactive",
      symbol: "BANKNIFTY",
      exchange: "NSE",
      quantity: 25,
      entryCondition: "Breakout above resistance",
      exitCondition: "Quick profit booking at 0.5%",
      stopLoss: 0.3,
      targetProfit: 0.5,
      totalTrades: 120,
      winningTrades: 85,
      profitLoss: 78500,
    };
    this.strategiesMap.set(strategy2.id, strategy2);

    // Sample webhook
    const webhook1: Webhook = {
      id: randomUUID(),
      name: "TradingView Alert",
      strategyId: strategy1.id,
      webhookUrl: "https://api.example.com/webhook/trade",
      secretKey: "sk_live_xxxxxxxxxxxx",
      isActive: true,
      triggerType: "both",
      lastTriggered: "2026-01-22 10:30:00",
      totalTriggers: 15,
    };
    this.webhooksMap.set(webhook1.id, webhook1);
  }

  // Strategies (in-memory)
  async getStrategies(): Promise<Strategy[]> {
    return Array.from(this.strategiesMap.values());
  }

  async getStrategy(id: string): Promise<Strategy | undefined> {
    return this.strategiesMap.get(id);
  }

  async createStrategy(insertStrategy: InsertStrategy): Promise<Strategy> {
    const id = randomUUID();
    const strategy: Strategy = {
      id,
      name: insertStrategy.name,
      description: insertStrategy.description ?? null,
      type: insertStrategy.type,
      status: insertStrategy.status ?? "inactive",
      symbol: insertStrategy.symbol,
      exchange: insertStrategy.exchange ?? "NSE",
      quantity: insertStrategy.quantity ?? 1,
      entryCondition: insertStrategy.entryCondition ?? null,
      exitCondition: insertStrategy.exitCondition ?? null,
      stopLoss: insertStrategy.stopLoss ?? null,
      targetProfit: insertStrategy.targetProfit ?? null,
      totalTrades: 0,
      winningTrades: 0,
      profitLoss: 0,
    };
    this.strategiesMap.set(id, strategy);
    return strategy;
  }

  async updateStrategy(id: string, update: Partial<InsertStrategy>): Promise<Strategy | undefined> {
    const strategy = this.strategiesMap.get(id);
    if (!strategy) return undefined;
    const updated = { ...strategy, ...update };
    this.strategiesMap.set(id, updated);
    return updated;
  }

  async deleteStrategy(id: string): Promise<boolean> {
    return this.strategiesMap.delete(id);
  }

  // Webhooks (in-memory)
  async getWebhooks(): Promise<Webhook[]> {
    return Array.from(this.webhooksMap.values());
  }

  async getWebhook(id: string): Promise<Webhook | undefined> {
    return this.webhooksMap.get(id);
  }

  async createWebhook(insertWebhook: InsertWebhook): Promise<Webhook> {
    const id = randomUUID();
    const webhook: Webhook = {
      id,
      name: insertWebhook.name,
      strategyId: insertWebhook.strategyId ?? null,
      webhookUrl: insertWebhook.webhookUrl,
      secretKey: insertWebhook.secretKey ?? null,
      isActive: insertWebhook.isActive ?? true,
      triggerType: insertWebhook.triggerType,
      lastTriggered: null,
      totalTriggers: 0,
    };
    this.webhooksMap.set(id, webhook);
    return webhook;
  }

  async updateWebhook(id: string, update: Partial<InsertWebhook>): Promise<Webhook | undefined> {
    const webhook = this.webhooksMap.get(id);
    if (!webhook) return undefined;
    const updated = { ...webhook, ...update };
    this.webhooksMap.set(id, updated);
    return updated;
  }

  async deleteWebhook(id: string): Promise<boolean> {
    return this.webhooksMap.delete(id);
  }

  // Webhook Logs (in-memory)
  async getWebhookLogs(): Promise<WebhookLog[]> {
    return Array.from(this.webhookLogsMap.values()).sort((a, b) => 
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
  }

  async createWebhookLog(insertLog: InsertWebhookLog): Promise<WebhookLog> {
    const id = randomUUID();
    const log: WebhookLog = {
      id,
      webhookId: insertLog.webhookId,
      timestamp: insertLog.timestamp,
      payload: insertLog.payload ?? null,
      status: insertLog.status,
      response: insertLog.response ?? null,
      executionTime: insertLog.executionTime ?? null,
    };
    this.webhookLogsMap.set(id, log);
    return log;
  }

  // Broker Configs - PERSISTENT in PostgreSQL database
  async getBrokerConfigs(): Promise<BrokerConfig[]> {
    return await db.select().from(brokerConfigs);
  }

  async getBrokerConfig(id: string): Promise<BrokerConfig | undefined> {
    const [config] = await db.select().from(brokerConfigs).where(eq(brokerConfigs.id, id));
    return config || undefined;
  }

  async getBrokerConfigByUcc(ucc: string): Promise<BrokerConfig | undefined> {
    const [config] = await db.select().from(brokerConfigs).where(eq(brokerConfigs.ucc, ucc));
    return config || undefined;
  }

  async createBrokerConfig(insertConfig: InsertBrokerConfig): Promise<BrokerConfig> {
    const id = randomUUID();
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const [config] = await db.insert(brokerConfigs).values({
      id,
      brokerName: insertConfig.brokerName,
      consumerKey: insertConfig.consumerKey ?? null,
      consumerSecret: insertConfig.consumerSecret ?? null,
      mobileNumber: insertConfig.mobileNumber ?? null,
      ucc: insertConfig.ucc ?? null,
      mpin: insertConfig.mpin ?? null,
      isConnected: false,
      accessToken: null,
      sessionId: null,
      baseUrl: null,
      viewToken: null,
      sidView: null,
      lastTotpUsed: null,
      lastTotpTime: null,
      lastConnected: null,
      connectionError: null,
      totalLogins: 0,
      successfulLogins: 0,
      failedLogins: 0,
      lastTestTime: null,
      lastTestResult: null,
      lastTestMessage: null,
      totalTests: 0,
      successfulTests: 0,
      createdAt: now,
      updatedAt: now,
    }).returning();
    return config;
  }

  async updateBrokerConfig(id: string, update: Partial<InsertBrokerConfig>): Promise<BrokerConfig | undefined> {
    const [config] = await db
      .update(brokerConfigs)
      .set(update)
      .where(eq(brokerConfigs.id, id))
      .returning();
    return config || undefined;
  }

  async deleteBrokerConfig(id: string): Promise<boolean> {
    const result = await db.delete(brokerConfigs).where(eq(brokerConfigs.id, id));
    return (result.rowCount ?? 0) > 0;
  }

  // Trading Data (mock data for demonstration - will be replaced by live data)
  async getPositions(): Promise<Position[]> {
    return [
      {
        trading_symbol: "COFORGE",
        exchange: "NSE",
        quantity: 375,
        buy_avg: 2.40,
        sell_avg: 0,
        pnl: 75.90,
        ltp: 2.30,
        product_type: "NRML",
        option_type: "CALL",
        strike_price: 1900,
        expiry: "27 JAN",
        realised_pnl: 0,
        unrealised_pnl: 75.90,
      },
      {
        trading_symbol: "ENGINERSIN",
        exchange: "NSE",
        quantity: 25,
        buy_avg: 248.00,
        sell_avg: 0,
        pnl: -1791.50,
        ltp: 176.34,
        product_type: "PAY LATER",
        realised_pnl: 0,
        unrealised_pnl: -1791.50,
      },
      {
        trading_symbol: "GOLDBEES",
        exchange: "NSE",
        quantity: 250,
        buy_avg: 127.18,
        sell_avg: 0,
        pnl: -711.00,
        ltp: 124.34,
        product_type: "PAY LATER",
        realised_pnl: 0,
        unrealised_pnl: -711.00,
      },
      {
        trading_symbol: "HINDZINC",
        exchange: "NSE",
        quantity: 28,
        buy_avg: 622.14,
        sell_avg: 0,
        pnl: 1291.00,
        ltp: 668.25,
        product_type: "PAY LATER",
        realised_pnl: 0,
        unrealised_pnl: 1291.00,
      },
      {
        trading_symbol: "JWL",
        exchange: "NSE",
        quantity: 25,
        buy_avg: 326.55,
        sell_avg: 0,
        pnl: -275.00,
        ltp: 315.55,
        product_type: "PAY LATER",
        realised_pnl: 0,
        unrealised_pnl: -275.00,
      },
      {
        trading_symbol: "KPITTECH",
        exchange: "NSE",
        quantity: 850,
        buy_avg: 1.96,
        sell_avg: 0,
        pnl: -2119.05,
        ltp: 0.30,
        product_type: "NRML",
        option_type: "CALL",
        strike_price: 1300,
        expiry: "27 JAN",
        realised_pnl: 0,
        unrealised_pnl: -2119.05,
      },
      {
        trading_symbol: "NHPC",
        exchange: "NSE",
        quantity: 200,
        buy_avg: 78.80,
        sell_avg: 0,
        pnl: -270.00,
        ltp: 77.45,
        product_type: "PAY LATER",
        realised_pnl: 0,
        unrealised_pnl: -270.00,
      },
      {
        trading_symbol: "OIL",
        exchange: "NSE",
        quantity: 15,
        buy_avg: 428.10,
        sell_avg: 0,
        pnl: 208.75,
        ltp: 436.45,
        product_type: "PAY LATER",
        realised_pnl: 0,
        unrealised_pnl: 208.75,
      },
    ];
  }

  async getOrders(): Promise<Order[]> {
    return [
      {
        order_id: "ORD001",
        trading_symbol: "RELIANCE",
        transaction_type: "B",
        quantity: 10,
        price: 2450.50,
        status: "COMPLETE",
        order_type: "L",
        exchange: "NSE",
        timestamp: "2026-01-22 09:30:15",
      },
      {
        order_id: "ORD002",
        trading_symbol: "HDFCBANK",
        transaction_type: "B",
        quantity: 20,
        price: 1680.00,
        status: "PENDING",
        order_type: "L",
        exchange: "NSE",
        timestamp: "2026-01-22 10:15:00",
      },
      {
        order_id: "ORD003",
        trading_symbol: "INFY",
        transaction_type: "S",
        quantity: 15,
        price: 1550.00,
        status: "CANCELLED",
        order_type: "L",
        exchange: "NSE",
        timestamp: "2026-01-22 11:00:30",
      },
    ];
  }

  async getHoldings(): Promise<Holding[]> {
    return [
      {
        trading_symbol: "TATASTEEL",
        quantity: 100,
        average_price: 125.50,
        current_price: 142.75,
        invested_value: 12550.00,
        current_value: 14275.00,
        pnl: 1725.00,
        pnl_percent: 13.75,
        today_pnl: 150.00,
        today_pnl_percent: 1.06,
        prev_close: 141.25,
      },
      {
        trading_symbol: "WIPRO",
        quantity: 50,
        average_price: 420.00,
        current_price: 455.50,
        invested_value: 21000.00,
        current_value: 22775.00,
        pnl: 1775.00,
        pnl_percent: 8.45,
        today_pnl: 125.00,
        today_pnl_percent: 0.55,
        prev_close: 453.00,
      },
      {
        trading_symbol: "ICICIBANK",
        quantity: 30,
        average_price: 980.00,
        current_price: 1050.25,
        invested_value: 29400.00,
        current_value: 31507.50,
        pnl: 2107.50,
        pnl_percent: 7.17,
        today_pnl: -75.00,
        today_pnl_percent: -0.24,
        prev_close: 1052.75,
      },
      {
        trading_symbol: "SBIN",
        quantity: 75,
        average_price: 650.00,
        current_price: 625.00,
        invested_value: 48750.00,
        current_value: 46875.00,
        pnl: -1875.00,
        pnl_percent: -3.85,
        today_pnl: 562.50,
        today_pnl_percent: 1.21,
        prev_close: 617.50,
      },
    ];
  }

  async getPortfolioSummary(): Promise<PortfolioSummary> {
    return {
      totalValue: 2850000,
      dayPnL: 12500,
      totalPnL: 185000,
      availableMargin: 450000,
    };
  }
}

export const storage = new DatabaseStorage();
