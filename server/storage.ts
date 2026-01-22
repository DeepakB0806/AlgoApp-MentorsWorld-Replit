import { randomUUID } from "crypto";
import type { 
  Strategy, InsertStrategy,
  Webhook, InsertWebhook,
  WebhookLog, InsertWebhookLog,
  BrokerConfig, InsertBrokerConfig,
  Position, Order, Holding, PortfolioSummary
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

  // Broker Configs
  getBrokerConfigs(): Promise<BrokerConfig[]>;
  getBrokerConfig(id: string): Promise<BrokerConfig | undefined>;
  createBrokerConfig(config: InsertBrokerConfig): Promise<BrokerConfig>;
  updateBrokerConfig(id: string, config: Partial<InsertBrokerConfig>): Promise<BrokerConfig | undefined>;
  deleteBrokerConfig(id: string): Promise<boolean>;

  // Trading Data (mock for now)
  getPositions(): Promise<Position[]>;
  getOrders(): Promise<Order[]>;
  getHoldings(): Promise<Holding[]>;
  getPortfolioSummary(): Promise<PortfolioSummary>;
}

export class MemStorage implements IStorage {
  private strategies: Map<string, Strategy>;
  private webhooks: Map<string, Webhook>;
  private webhookLogs: Map<string, WebhookLog>;
  private brokerConfigs: Map<string, BrokerConfig>;

  constructor() {
    this.strategies = new Map();
    this.webhooks = new Map();
    this.webhookLogs = new Map();
    this.brokerConfigs = new Map();

    // Add some sample data
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
    this.strategies.set(strategy1.id, strategy1);

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
    this.strategies.set(strategy2.id, strategy2);

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
    this.webhooks.set(webhook1.id, webhook1);

    // Sample broker config
    const brokerConfig1: BrokerConfig = {
      id: randomUUID(),
      brokerName: "kotak_neo",
      consumerKey: null,
      consumerSecret: null,
      mobileNumber: null,
      ucc: null,
      mpin: null,
      isConnected: false,
      lastConnected: null,
      connectionError: null,
      accessToken: null,
      sessionId: null,
      baseUrl: null,
    };
    this.brokerConfigs.set(brokerConfig1.id, brokerConfig1);
  }

  // Strategies
  async getStrategies(): Promise<Strategy[]> {
    return Array.from(this.strategies.values());
  }

  async getStrategy(id: string): Promise<Strategy | undefined> {
    return this.strategies.get(id);
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
    this.strategies.set(id, strategy);
    return strategy;
  }

  async updateStrategy(id: string, update: Partial<InsertStrategy>): Promise<Strategy | undefined> {
    const strategy = this.strategies.get(id);
    if (!strategy) return undefined;
    const updated = { ...strategy, ...update };
    this.strategies.set(id, updated);
    return updated;
  }

  async deleteStrategy(id: string): Promise<boolean> {
    return this.strategies.delete(id);
  }

  // Webhooks
  async getWebhooks(): Promise<Webhook[]> {
    return Array.from(this.webhooks.values());
  }

  async getWebhook(id: string): Promise<Webhook | undefined> {
    return this.webhooks.get(id);
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
    this.webhooks.set(id, webhook);
    return webhook;
  }

  async updateWebhook(id: string, update: Partial<InsertWebhook>): Promise<Webhook | undefined> {
    const webhook = this.webhooks.get(id);
    if (!webhook) return undefined;
    const updated = { ...webhook, ...update };
    this.webhooks.set(id, updated);
    return updated;
  }

  async deleteWebhook(id: string): Promise<boolean> {
    return this.webhooks.delete(id);
  }

  // Webhook Logs
  async getWebhookLogs(): Promise<WebhookLog[]> {
    return Array.from(this.webhookLogs.values()).sort((a, b) => 
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
    this.webhookLogs.set(id, log);
    return log;
  }

  // Broker Configs
  async getBrokerConfigs(): Promise<BrokerConfig[]> {
    return Array.from(this.brokerConfigs.values());
  }

  async getBrokerConfig(id: string): Promise<BrokerConfig | undefined> {
    return this.brokerConfigs.get(id);
  }

  async createBrokerConfig(insertConfig: InsertBrokerConfig): Promise<BrokerConfig> {
    const id = randomUUID();
    const config: BrokerConfig = {
      id,
      brokerName: insertConfig.brokerName,
      consumerKey: insertConfig.consumerKey ?? null,
      consumerSecret: insertConfig.consumerSecret ?? null,
      mobileNumber: insertConfig.mobileNumber ?? null,
      ucc: insertConfig.ucc ?? null,
      mpin: insertConfig.mpin ?? null,
      isConnected: false,
      lastConnected: null,
      connectionError: null,
      accessToken: null,
      sessionId: null,
      baseUrl: null,
    };
    this.brokerConfigs.set(id, config);
    return config;
  }

  async updateBrokerConfig(id: string, update: Partial<InsertBrokerConfig>): Promise<BrokerConfig | undefined> {
    const config = this.brokerConfigs.get(id);
    if (!config) return undefined;
    const updated = { ...config, ...update };
    this.brokerConfigs.set(id, updated);
    return updated;
  }

  async deleteBrokerConfig(id: string): Promise<boolean> {
    return this.brokerConfigs.delete(id);
  }

  // Trading Data (mock data for demonstration)
  async getPositions(): Promise<Position[]> {
    return [
      {
        trading_symbol: "RELIANCE",
        exchange: "NSE",
        quantity: 10,
        buy_avg: 2450.50,
        sell_avg: 0,
        pnl: 1250.00,
        ltp: 2575.50,
      },
      {
        trading_symbol: "INFY",
        exchange: "NSE",
        quantity: 25,
        buy_avg: 1520.00,
        sell_avg: 0,
        pnl: -375.00,
        ltp: 1505.00,
      },
      {
        trading_symbol: "TCS",
        exchange: "NSE",
        quantity: 15,
        buy_avg: 3850.00,
        sell_avg: 0,
        pnl: 2250.00,
        ltp: 4000.00,
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
        pnl: 1725.00,
        pnl_percent: 13.75,
      },
      {
        trading_symbol: "WIPRO",
        quantity: 50,
        average_price: 420.00,
        current_price: 455.50,
        pnl: 1775.00,
        pnl_percent: 8.45,
      },
      {
        trading_symbol: "ICICIBANK",
        quantity: 30,
        average_price: 980.00,
        current_price: 1050.25,
        pnl: 2107.50,
        pnl_percent: 7.17,
      },
      {
        trading_symbol: "SBIN",
        quantity: 75,
        average_price: 650.00,
        current_price: 625.00,
        pnl: -1875.00,
        pnl_percent: -3.85,
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

export const storage = new MemStorage();
