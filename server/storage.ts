import { randomUUID, randomBytes } from "crypto";
import { eq, desc, and, lt, sql } from "drizzle-orm";
import { db } from "./db";
import { 
  strategies, webhooks, webhookLogs, webhookStatusLogs, webhookData, appSettings, brokerConfigs, webhookRegistry,
  brokerTestLogs, brokerSessionLogs, strategyConfigs, strategyPlans, strategyTrades, strategyDailyPnl,
  broker_field_mappings, universal_fields,
  type Strategy, type InsertStrategy,
  type Webhook, type InsertWebhook,
  type WebhookLog, type InsertWebhookLog,
  type WebhookStatusLog, type InsertWebhookStatusLog,
  type WebhookData, type InsertWebhookData,
  type AppSetting, type InsertAppSetting,
  type BrokerConfig, type InsertBrokerConfig,
  type WebhookRegistry, type InsertWebhookRegistry,
  type BrokerTestLog, type InsertBrokerTestLog,
  type BrokerSessionLog, type InsertBrokerSessionLog,
  type StrategyConfig, type InsertStrategyConfig,
  type StrategyPlan, type InsertStrategyPlan,
  type StrategyTrade, type InsertStrategyTrade,
  type StrategyDailyPnl, type InsertStrategyDailyPnl,
  type BrokerFieldMapping, type InsertBrokerFieldMapping,
  type UniversalField, type InsertUniversalField,
  type Position, type Order, type Holding, type PortfolioSummary
} from "@shared/schema";

// Generate a short unique code for webhooks (6 alphanumeric chars)
function generateUniqueCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Avoiding similar chars like 0/O, 1/I
  let code = '';
  const bytes = randomBytes(6);
  for (let i = 0; i < 6; i++) {
    code += chars[bytes[i] % chars.length];
  }
  return code;
}

export interface IStorage {
  // Strategies
  getStrategies(): Promise<Strategy[]>;
  getStrategy(id: string): Promise<Strategy | undefined>;
  createStrategy(strategy: InsertStrategy): Promise<Strategy>;
  updateStrategy(id: string, strategy: Partial<InsertStrategy>): Promise<Strategy | undefined>;
  deleteStrategy(id: string): Promise<boolean>;

  // Webhooks - persisted in database
  getWebhooks(): Promise<Webhook[]>;
  getWebhook(id: string): Promise<Webhook | undefined>;
  getWebhookByUniqueCode(uniqueCode: string): Promise<Webhook | undefined>;
  getWebhooksLinkingTo(webhookId: string): Promise<Webhook[]>; // Find webhooks that link to this webhook
  createWebhook(webhook: InsertWebhook, createdBy?: string): Promise<Webhook>;
  updateWebhook(id: string, webhook: Partial<InsertWebhook>): Promise<Webhook | undefined>;
  deleteWebhook(id: string): Promise<boolean>;

  // Webhook Registry - central table for all webhook codes (past and present)
  getWebhookRegistry(): Promise<WebhookRegistry[]>;
  getWebhookRegistryEntry(uniqueCode: string): Promise<WebhookRegistry | undefined>;
  createWebhookRegistryEntry(entry: InsertWebhookRegistry): Promise<WebhookRegistry>;
  markWebhookRegistryInactive(webhookId: string): Promise<WebhookRegistry | undefined>;

  // Webhook Logs - persisted in database
  getWebhookLogs(): Promise<WebhookLog[]>;
  getWebhookLogsByWebhookId(webhookId: string): Promise<WebhookLog[]>;
  createWebhookLog(log: InsertWebhookLog): Promise<WebhookLog>;

  // Webhook Status Logs - persisted in database
  getWebhookStatusLogs(webhookId: string): Promise<WebhookStatusLog[]>;
  createWebhookStatusLog(log: InsertWebhookStatusLog): Promise<WebhookStatusLog>;
  
  // Webhook Stats and Cleanup
  getWebhookLogStats(webhookId: string): Promise<{ total: number; success: number; failed: number; successRate: number; avgResponseTime: number }>;
  deleteOldWebhookLogs(webhookId: string, daysToKeep: number): Promise<number>;
  deleteAllWebhookLogs(webhookId: string): Promise<number>;
  deleteOldLogsGlobally(daysToKeep: number): Promise<number>;

  // Webhook Data - stores incoming JSON data for strategy access
  getWebhookData(limit?: number): Promise<WebhookData[]>;
  getWebhookDataByWebhook(webhookId: string): Promise<WebhookData[]>;
  getWebhookDataByStrategy(strategyId: string): Promise<WebhookData[]>;
  getLatestWebhookData(webhookId: string): Promise<WebhookData | undefined>;
  createWebhookData(data: InsertWebhookData): Promise<WebhookData>;
  markWebhookDataProcessed(id: string): Promise<WebhookData | undefined>;
  deleteWebhookData(webhookId: string, daysToKeep: number): Promise<number>;
  deleteWebhookDataOlderThan(daysToKeep: number): Promise<number>;
  deleteAllWebhookData(): Promise<number>;

  // App Settings - persisted in database
  getSetting(key: string): Promise<AppSetting | undefined>;
  setSetting(key: string, value: string): Promise<AppSetting>;

  // Broker Configs - persisted in database
  getBrokerConfigs(): Promise<BrokerConfig[]>;
  getBrokerConfig(id: string): Promise<BrokerConfig | undefined>;
  getBrokerConfigByUcc(ucc: string): Promise<BrokerConfig | undefined>;
  createBrokerConfig(config: InsertBrokerConfig): Promise<BrokerConfig>;
  updateBrokerConfig(id: string, config: Partial<InsertBrokerConfig>): Promise<BrokerConfig | undefined>;
  deleteBrokerConfig(id: string): Promise<boolean>;

  // Broker Test Logs
  getBrokerTestLogs(brokerConfigId: string): Promise<BrokerTestLog[]>;
  createBrokerTestLog(log: InsertBrokerTestLog): Promise<BrokerTestLog>;
  deleteBrokerTestLogs(brokerConfigId: string, days?: number): Promise<number>;

  // Broker Session Logs
  getBrokerSessionLogs(brokerConfigId: string): Promise<BrokerSessionLog[]>;
  createBrokerSessionLog(log: InsertBrokerSessionLog): Promise<BrokerSessionLog>;
  deleteBrokerSessionLogs(brokerConfigId: string, days?: number): Promise<number>;

  // Strategy Configs (Mother Configurator) - persisted in database
  getStrategyConfigs(): Promise<StrategyConfig[]>;
  getStrategyConfig(id: string): Promise<StrategyConfig | undefined>;
  getStrategyConfigByWebhookId(webhookId: string): Promise<StrategyConfig | undefined>;
  createStrategyConfig(config: InsertStrategyConfig): Promise<StrategyConfig>;
  updateStrategyConfig(id: string, config: Partial<InsertStrategyConfig>): Promise<StrategyConfig | undefined>;
  deleteStrategyConfig(id: string): Promise<boolean>;

  // Strategy Plans (Trade Planning) - persisted in database
  getStrategyPlans(): Promise<StrategyPlan[]>;
  getStrategyPlansByConfig(configId: string): Promise<StrategyPlan[]>;
  getStrategyPlan(id: string): Promise<StrategyPlan | undefined>;
  createStrategyPlan(plan: InsertStrategyPlan): Promise<StrategyPlan>;
  updateStrategyPlan(id: string, plan: Partial<InsertStrategyPlan>): Promise<StrategyPlan | undefined>;
  deleteStrategyPlan(id: string): Promise<boolean>;

  // Strategy Trades - records trades executed by strategy plans
  getStrategyTradesByPlan(planId: string): Promise<StrategyTrade[]>;
  getOpenTradesByPlan(planId: string): Promise<StrategyTrade[]>;
  createStrategyTrade(trade: InsertStrategyTrade): Promise<StrategyTrade>;
  updateStrategyTrade(id: string, trade: Partial<InsertStrategyTrade>): Promise<StrategyTrade | undefined>;
  deleteStrategyTradesByPlan(planId: string, olderThanDays?: number): Promise<number>;
  deleteAllStrategyTradesByPlan(planId: string): Promise<number>;

  // Strategy Daily P&L - daily P&L log entries
  getStrategyDailyPnl(planId: string): Promise<StrategyDailyPnl[]>;
  createStrategyDailyPnl(entry: InsertStrategyDailyPnl): Promise<StrategyDailyPnl>;
  updateStrategyDailyPnl(id: string, entry: Partial<InsertStrategyDailyPnl>): Promise<StrategyDailyPnl | undefined>;
  deleteStrategyDailyPnlByPlan(planId: string, olderThanDays?: number): Promise<number>;
  deleteAllStrategyDailyPnlByPlan(planId: string): Promise<number>;

  // Broker Field Mappings
  getBrokerFieldMappings(brokerName: string, category?: string): Promise<BrokerFieldMapping[]>;
  getBrokerFieldMappingById(id: number): Promise<BrokerFieldMapping | undefined>;
  getBrokerFieldMappingStats(brokerName: string): Promise<{ matched: number; pending: number; gap: number; not_applicable: number; total: number }>;
  upsertBrokerFieldMappings(fields: InsertBrokerFieldMapping[]): Promise<BrokerFieldMapping[]>;
  updateBrokerFieldMapping(id: number, data: Partial<InsertBrokerFieldMapping>): Promise<BrokerFieldMapping | undefined>;
  deleteBrokerFieldMappings(brokerName: string): Promise<number>;

  // Universal Fields
  getUniversalFields(category?: string): Promise<UniversalField[]>;
  getUniversalField(id: number): Promise<UniversalField | undefined>;
  createUniversalField(field: InsertUniversalField): Promise<UniversalField>;
  updateUniversalField(id: number, data: Partial<InsertUniversalField>): Promise<UniversalField | undefined>;
  deleteUniversalField(id: number): Promise<boolean>;
  ensureUniversalFields(): Promise<{ inserted: number; existing: number }>;

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
      uniqueCode: generateUniqueCode(),
      name: "TradingView Alert",
      strategyId: strategy1.id,
      webhookUrl: "https://api.example.com/webhook/trade",
      secretKey: "sk_live_xxxxxxxxxxxx",
      isActive: true,
      triggerType: "both",
      lastTriggered: "2026-01-22 10:30:00",
      totalTriggers: 15,
      fieldConfig: null,
      dataTableName: null,
      linkedWebhookId: null,
      linkedByWebhooks: null,
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

  // Webhooks - PERSISTENT in PostgreSQL database
  async getWebhooks(): Promise<Webhook[]> {
    return await db.select().from(webhooks);
  }

  async getWebhook(id: string): Promise<Webhook | undefined> {
    const [webhook] = await db.select().from(webhooks).where(eq(webhooks.id, id));
    return webhook || undefined;
  }

  async getWebhookByUniqueCode(uniqueCode: string): Promise<Webhook | undefined> {
    const [webhook] = await db.select().from(webhooks).where(eq(webhooks.uniqueCode, uniqueCode.toUpperCase()));
    return webhook || undefined;
  }

  async getWebhooksLinkingTo(webhookId: string): Promise<Webhook[]> {
    return await db.select().from(webhooks).where(eq(webhooks.linkedWebhookId, webhookId));
  }

  async createWebhook(insertWebhook: InsertWebhook, createdBy?: string): Promise<Webhook> {
    const id = randomUUID();
    const uniqueCode = generateUniqueCode();
    const [webhook] = await db.insert(webhooks).values({
      id,
      uniqueCode,
      name: insertWebhook.name,
      strategyId: insertWebhook.strategyId ?? null,
      webhookUrl: insertWebhook.webhookUrl,
      secretKey: insertWebhook.secretKey ?? null,
      isActive: insertWebhook.isActive ?? true,
      triggerType: insertWebhook.triggerType,
      lastTriggered: null,
      totalTriggers: 0,
    }).returning();
    
    // Also register in webhook registry for historical tracking
    await this.createWebhookRegistryEntry({
      uniqueCode,
      webhookId: id,
      webhookName: insertWebhook.name,
      createdBy: createdBy ?? null,
      isActive: true,
      deletedAt: null,
      notes: null,
    });
    
    return webhook;
  }

  async updateWebhook(id: string, update: Partial<InsertWebhook>): Promise<Webhook | undefined> {
    const [webhook] = await db.update(webhooks)
      .set(update)
      .where(eq(webhooks.id, id))
      .returning();
    return webhook || undefined;
  }

  async deleteWebhook(id: string): Promise<boolean> {
    // Mark registry entry as inactive before deleting
    await this.markWebhookRegistryInactive(id);
    await db.delete(webhooks).where(eq(webhooks.id, id));
    return true;
  }

  // Webhook Registry - PERSISTENT in PostgreSQL database
  async getWebhookRegistry(): Promise<WebhookRegistry[]> {
    return await db.select().from(webhookRegistry).orderBy(desc(webhookRegistry.createdAt));
  }

  async getWebhookRegistryEntry(uniqueCode: string): Promise<WebhookRegistry | undefined> {
    const [entry] = await db.select().from(webhookRegistry).where(eq(webhookRegistry.uniqueCode, uniqueCode.toUpperCase()));
    return entry || undefined;
  }

  async createWebhookRegistryEntry(entry: InsertWebhookRegistry): Promise<WebhookRegistry> {
    const id = randomUUID();
    const [registryEntry] = await db.insert(webhookRegistry).values({
      id,
      uniqueCode: entry.uniqueCode,
      webhookId: entry.webhookId ?? null,
      webhookName: entry.webhookName,
      createdBy: entry.createdBy ?? null,
      isActive: entry.isActive ?? true,
      deletedAt: entry.deletedAt ?? null,
      notes: entry.notes ?? null,
    }).returning();
    return registryEntry;
  }

  async markWebhookRegistryInactive(webhookId: string): Promise<WebhookRegistry | undefined> {
    const [entry] = await db.update(webhookRegistry)
      .set({ 
        isActive: false, 
        deletedAt: new Date(),
        webhookId: null 
      })
      .where(eq(webhookRegistry.webhookId, webhookId))
      .returning();
    return entry || undefined;
  }

  // Webhook Logs - PERSISTENT in PostgreSQL database
  async getWebhookLogs(): Promise<WebhookLog[]> {
    return await db.select().from(webhookLogs).orderBy(desc(webhookLogs.timestamp)).limit(100);
  }

  async getWebhookLogsByWebhookId(webhookId: string): Promise<WebhookLog[]> {
    return await db.select().from(webhookLogs)
      .where(eq(webhookLogs.webhookId, webhookId))
      .orderBy(desc(webhookLogs.timestamp))
      .limit(100);
  }

  async createWebhookLog(insertLog: InsertWebhookLog): Promise<WebhookLog> {
    const id = randomUUID();
    const [log] = await db.insert(webhookLogs).values({
      id,
      webhookId: insertLog.webhookId,
      timestamp: insertLog.timestamp,
      payload: insertLog.payload ?? null,
      status: insertLog.status,
      response: insertLog.response ?? null,
      executionTime: insertLog.executionTime ?? null,
      timeUnix: insertLog.timeUnix ?? null,
      exchange: insertLog.exchange ?? null,
      indices: insertLog.indices ?? null,
      indicator: insertLog.indicator ?? null,
      alert: insertLog.alert ?? null,
      price: insertLog.price ?? null,
      localTime: insertLog.localTime ?? null,
      mode: insertLog.mode ?? null,
      modeDesc: insertLog.modeDesc ?? null,
      firstLine: insertLog.firstLine ?? null,
      midLine: insertLog.midLine ?? null,
      slowLine: insertLog.slowLine ?? null,
      st: insertLog.st ?? null,
      ht: insertLog.ht ?? null,
      rsi: insertLog.rsi ?? null,
      rsiScaled: insertLog.rsiScaled ?? null,
      alertSystem: insertLog.alertSystem ?? null,
      actionBinary: insertLog.actionBinary ?? null,
      lockState: insertLog.lockState ?? null,
    }).returning();
    return log;
  }

  // Webhook Status Logs - PERSISTENT in PostgreSQL database
  async getWebhookStatusLogs(webhookId: string): Promise<WebhookStatusLog[]> {
    return await db.select().from(webhookStatusLogs)
      .where(eq(webhookStatusLogs.webhookId, webhookId))
      .orderBy(desc(webhookStatusLogs.testedAt))
      .limit(100);
  }

  async createWebhookStatusLog(insertLog: InsertWebhookStatusLog): Promise<WebhookStatusLog> {
    const id = randomUUID();
    const [log] = await db.insert(webhookStatusLogs).values({
      id,
      webhookId: insertLog.webhookId,
      testPayload: insertLog.testPayload ?? null,
      status: insertLog.status,
      statusCode: insertLog.statusCode ?? null,
      responseMessage: insertLog.responseMessage ?? null,
      errorMessage: insertLog.errorMessage ?? null,
      responseTime: insertLog.responseTime ?? null,
      testedAt: insertLog.testedAt,
    }).returning();
    return log;
  }

  // Webhook Stats - PERSISTENT in PostgreSQL database
  async getWebhookLogStats(webhookId: string): Promise<{ total: number; success: number; failed: number; successRate: number; avgResponseTime: number }> {
    const logs = await db.select().from(webhookStatusLogs)
      .where(eq(webhookStatusLogs.webhookId, webhookId));
    
    const total = logs.length;
    const success = logs.filter(l => l.status === "success").length;
    const failed = logs.filter(l => l.status === "failed").length;
    const successRate = total > 0 ? Math.round((success / total) * 100) : 0;
    
    const responseTimes = logs.filter(l => l.responseTime != null).map(l => l.responseTime!);
    const avgResponseTime = responseTimes.length > 0 
      ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length)
      : 0;
    
    return { total, success, failed, successRate, avgResponseTime };
  }

  async deleteOldWebhookLogs(webhookId: string, daysToKeep: number): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
    
    const result = await db.delete(webhookStatusLogs)
      .where(
        and(
          eq(webhookStatusLogs.webhookId, webhookId),
          lt(webhookStatusLogs.testedAt, cutoffDate.toISOString())
        )
      )
      .returning();
    
    return result.length;
  }

  async deleteAllWebhookLogs(webhookId: string): Promise<number> {
    const result = await db.delete(webhookStatusLogs)
      .where(eq(webhookStatusLogs.webhookId, webhookId))
      .returning();
    
    return result.length;
  }

  async deleteOldLogsGlobally(daysToKeep: number): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
    
    const result = await db.delete(webhookStatusLogs)
      .where(lt(webhookStatusLogs.testedAt, cutoffDate.toISOString()))
      .returning();
    
    return result.length;
  }

  // Webhook Data - PERSISTENT in PostgreSQL database
  async getWebhookData(maxRows?: number): Promise<WebhookData[]> {
    const query = db.select().from(webhookData).orderBy(desc(webhookData.receivedAt));
    if (maxRows) {
      return await query.limit(maxRows);
    }
    return await query;
  }

  async getWebhookDataByWebhook(webhookId: string): Promise<WebhookData[]> {
    return await db.select().from(webhookData)
      .where(eq(webhookData.webhookId, webhookId))
      .orderBy(desc(webhookData.receivedAt));
  }

  async getWebhookDataByStrategy(strategyId: string): Promise<WebhookData[]> {
    return await db.select().from(webhookData)
      .where(eq(webhookData.strategyId, strategyId))
      .orderBy(desc(webhookData.receivedAt));
  }

  async getLatestWebhookData(webhookId: string): Promise<WebhookData | undefined> {
    const [latest] = await db.select().from(webhookData)
      .where(eq(webhookData.webhookId, webhookId))
      .orderBy(desc(webhookData.receivedAt))
      .limit(1);
    return latest || undefined;
  }

  async createWebhookData(data: InsertWebhookData): Promise<WebhookData> {
    const id = randomUUID();
    const [created] = await db.insert(webhookData).values({ ...data, id }).returning();
    return created;
  }

  async markWebhookDataProcessed(id: string): Promise<WebhookData | undefined> {
    const [updated] = await db.update(webhookData)
      .set({ isProcessed: true, processedAt: new Date().toISOString() })
      .where(eq(webhookData.id, id))
      .returning();
    return updated || undefined;
  }

  async deleteWebhookData(webhookId: string, daysToKeep: number): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
    
    const result = await db.delete(webhookData)
      .where(
        and(
          eq(webhookData.webhookId, webhookId),
          lt(webhookData.receivedAt, cutoffDate.toISOString())
        )
      )
      .returning();
    
    return result.length;
  }

  async deleteWebhookDataOlderThan(daysToKeep: number): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
    
    const result = await db.delete(webhookData)
      .where(lt(webhookData.receivedAt, cutoffDate.toISOString()))
      .returning();
    
    return result.length;
  }

  async deleteAllWebhookData(): Promise<number> {
    const result = await db.delete(webhookData).returning();
    return result.length;
  }

  // App Settings - PERSISTENT in PostgreSQL database
  async getSetting(key: string): Promise<AppSetting | undefined> {
    const [setting] = await db.select().from(appSettings).where(eq(appSettings.key, key));
    return setting || undefined;
  }

  async setSetting(key: string, value: string): Promise<AppSetting> {
    const existing = await this.getSetting(key);
    const now = new Date().toISOString();
    
    if (existing) {
      const [updated] = await db.update(appSettings)
        .set({ value, updatedAt: now })
        .where(eq(appSettings.key, key))
        .returning();
      return updated;
    } else {
      const id = randomUUID();
      const [setting] = await db.insert(appSettings).values({
        id,
        key,
        value,
        createdAt: now,
        updatedAt: now,
      }).returning();
      return setting;
    }
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

  // Broker Test Logs
  async getBrokerTestLogs(brokerConfigId: string): Promise<BrokerTestLog[]> {
    return await db.select().from(brokerTestLogs)
      .where(eq(brokerTestLogs.brokerConfigId, brokerConfigId))
      .orderBy(desc(brokerTestLogs.testedAt));
  }

  async createBrokerTestLog(log: InsertBrokerTestLog): Promise<BrokerTestLog> {
    const id = randomUUID();
    const [result] = await db.insert(brokerTestLogs).values({ ...log, id }).returning();
    return result;
  }

  async deleteBrokerTestLogs(brokerConfigId: string, days?: number): Promise<number> {
    if (days) {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - days);
      const cutoffStr = cutoffDate.toISOString();
      const deleted = await db.delete(brokerTestLogs)
        .where(and(eq(brokerTestLogs.brokerConfigId, brokerConfigId), lt(brokerTestLogs.testedAt, cutoffStr)))
        .returning();
      return deleted.length;
    }
    const deleted = await db.delete(brokerTestLogs)
      .where(eq(brokerTestLogs.brokerConfigId, brokerConfigId))
      .returning();
    return deleted.length;
  }

  // Broker Session Logs
  async getBrokerSessionLogs(brokerConfigId: string): Promise<BrokerSessionLog[]> {
    return await db.select().from(brokerSessionLogs)
      .where(eq(brokerSessionLogs.brokerConfigId, brokerConfigId))
      .orderBy(desc(brokerSessionLogs.loginAt));
  }

  async createBrokerSessionLog(log: InsertBrokerSessionLog): Promise<BrokerSessionLog> {
    const id = randomUUID();
    const [result] = await db.insert(brokerSessionLogs).values({ ...log, id }).returning();
    return result;
  }

  async deleteBrokerSessionLogs(brokerConfigId: string, days?: number): Promise<number> {
    if (days) {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - days);
      const cutoffStr = cutoffDate.toISOString();
      const deleted = await db.delete(brokerSessionLogs)
        .where(and(eq(brokerSessionLogs.brokerConfigId, brokerConfigId), lt(brokerSessionLogs.loginAt, cutoffStr)))
        .returning();
      return deleted.length;
    }
    const deleted = await db.delete(brokerSessionLogs)
      .where(eq(brokerSessionLogs.brokerConfigId, brokerConfigId))
      .returning();
    return deleted.length;
  }

  // Strategy Configs (Mother Configurator) - PERSISTENT in PostgreSQL
  async getStrategyConfigs(): Promise<StrategyConfig[]> {
    return await db.select().from(strategyConfigs).orderBy(desc(strategyConfigs.createdAt));
  }

  async getStrategyConfig(id: string): Promise<StrategyConfig | undefined> {
    const [config] = await db.select().from(strategyConfigs).where(eq(strategyConfigs.id, id));
    return config || undefined;
  }

  async getStrategyConfigByWebhookId(webhookId: string): Promise<StrategyConfig | undefined> {
    const [config] = await db.select().from(strategyConfigs).where(eq(strategyConfigs.webhookId, webhookId));
    return config || undefined;
  }

  async createStrategyConfig(insertConfig: InsertStrategyConfig): Promise<StrategyConfig> {
    const id = randomUUID();
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const [config] = await db.insert(strategyConfigs).values({
      id,
      name: insertConfig.name,
      description: insertConfig.description ?? null,
      webhookId: insertConfig.webhookId ?? null,
      indicators: insertConfig.indicators ?? null,
      actionMapper: insertConfig.actionMapper ?? null,
      uptrendBlock: insertConfig.uptrendBlock ?? null,
      downtrendBlock: insertConfig.downtrendBlock ?? null,
      neutralBlock: insertConfig.neutralBlock ?? null,
      status: insertConfig.status ?? "draft",
      createdBy: insertConfig.createdBy ?? null,
      createdAt: now,
      updatedAt: now,
    }).returning();
    return config;
  }

  async updateStrategyConfig(id: string, update: Partial<InsertStrategyConfig>): Promise<StrategyConfig | undefined> {
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const [config] = await db.update(strategyConfigs)
      .set({ ...update, updatedAt: now })
      .where(eq(strategyConfigs.id, id))
      .returning();
    return config || undefined;
  }

  async deleteStrategyConfig(id: string): Promise<boolean> {
    const result = await db.delete(strategyConfigs).where(eq(strategyConfigs.id, id));
    return (result.rowCount ?? 0) > 0;
  }

  // Strategy Plans (Trade Planning) - PERSISTENT in PostgreSQL
  async getStrategyPlans(): Promise<StrategyPlan[]> {
    return await db.select().from(strategyPlans).orderBy(desc(strategyPlans.createdAt));
  }

  async getStrategyPlansByConfig(configId: string): Promise<StrategyPlan[]> {
    return await db.select().from(strategyPlans)
      .where(eq(strategyPlans.configId, configId))
      .orderBy(desc(strategyPlans.createdAt));
  }

  async getStrategyPlan(id: string): Promise<StrategyPlan | undefined> {
    const [plan] = await db.select().from(strategyPlans).where(eq(strategyPlans.id, id));
    return plan || undefined;
  }

  async createStrategyPlan(insertPlan: InsertStrategyPlan): Promise<StrategyPlan> {
    const id = randomUUID();
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const [plan] = await db.insert(strategyPlans).values({
      id,
      name: insertPlan.name,
      description: insertPlan.description ?? null,
      configId: insertPlan.configId,
      selectedIndicators: insertPlan.selectedIndicators ?? null,
      tradeParams: insertPlan.tradeParams ?? null,
      status: insertPlan.status ?? "draft",
      brokerConfigId: insertPlan.brokerConfigId ?? null,
      isProxyMode: insertPlan.isProxyMode ?? false,
      createdBy: insertPlan.createdBy ?? null,
      createdAt: now,
      updatedAt: now,
    }).returning();
    return plan;
  }

  async updateStrategyPlan(id: string, update: Partial<InsertStrategyPlan>): Promise<StrategyPlan | undefined> {
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const [plan] = await db.update(strategyPlans)
      .set({ ...update, updatedAt: now })
      .where(eq(strategyPlans.id, id))
      .returning();
    return plan || undefined;
  }

  async deleteStrategyPlan(id: string): Promise<boolean> {
    const result = await db.delete(strategyPlans).where(eq(strategyPlans.id, id));
    return (result.rowCount ?? 0) > 0;
  }

  async getStrategyTradesByPlan(planId: string): Promise<StrategyTrade[]> {
    return await db.select().from(strategyTrades).where(eq(strategyTrades.planId, planId)).orderBy(desc(strategyTrades.createdAt));
  }

  async getOpenTradesByPlan(planId: string): Promise<StrategyTrade[]> {
    return await db.select().from(strategyTrades)
      .where(and(
        eq(strategyTrades.planId, planId),
        eq(strategyTrades.status, "open")
      ));
  }

  async createStrategyTrade(trade: InsertStrategyTrade): Promise<StrategyTrade> {
    const id = randomUUID();
    const [result] = await db.insert(strategyTrades).values({ ...trade, id }).returning();
    return result;
  }

  async updateStrategyTrade(id: string, trade: Partial<InsertStrategyTrade>): Promise<StrategyTrade | undefined> {
    const [result] = await db.update(strategyTrades).set(trade).where(eq(strategyTrades.id, id)).returning();
    return result;
  }

  async deleteStrategyTradesByPlan(planId: string, olderThanDays?: number): Promise<number> {
    if (olderThanDays) {
      const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
      const result = await db.delete(strategyTrades)
        .where(and(eq(strategyTrades.planId, planId), lt(strategyTrades.createdAt, cutoff)))
        .returning();
      return result.length;
    }
    return this.deleteAllStrategyTradesByPlan(planId);
  }

  async deleteAllStrategyTradesByPlan(planId: string): Promise<number> {
    const result = await db.delete(strategyTrades).where(eq(strategyTrades.planId, planId)).returning();
    return result.length;
  }

  async getStrategyDailyPnl(planId: string): Promise<StrategyDailyPnl[]> {
    return await db.select().from(strategyDailyPnl).where(eq(strategyDailyPnl.planId, planId)).orderBy(desc(strategyDailyPnl.date));
  }

  async createStrategyDailyPnl(entry: InsertStrategyDailyPnl): Promise<StrategyDailyPnl> {
    const id = randomUUID();
    const [result] = await db.insert(strategyDailyPnl).values({ ...entry, id }).returning();
    return result;
  }

  async updateStrategyDailyPnl(id: string, entry: Partial<InsertStrategyDailyPnl>): Promise<StrategyDailyPnl | undefined> {
    const [result] = await db.update(strategyDailyPnl).set(entry).where(eq(strategyDailyPnl.id, id)).returning();
    return result;
  }

  async deleteStrategyDailyPnlByPlan(planId: string, olderThanDays?: number): Promise<number> {
    if (olderThanDays !== undefined) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - olderThanDays);
      const cutoffStr = cutoff.toISOString().split("T")[0];
      const result = await db.delete(strategyDailyPnl).where(and(eq(strategyDailyPnl.planId, planId), lt(strategyDailyPnl.date, cutoffStr))).returning();
      return result.length;
    }
    return this.deleteAllStrategyDailyPnlByPlan(planId);
  }

  async deleteAllStrategyDailyPnlByPlan(planId: string): Promise<number> {
    const result = await db.delete(strategyDailyPnl).where(eq(strategyDailyPnl.planId, planId)).returning();
    return result.length;
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

  // Broker Field Mappings - PERSISTENT in PostgreSQL
  async getBrokerFieldMappings(brokerName: string, category?: string): Promise<BrokerFieldMapping[]> {
    if (category) {
      return db.select().from(broker_field_mappings)
        .where(and(eq(broker_field_mappings.brokerName, brokerName), eq(broker_field_mappings.category, category)))
        .orderBy(broker_field_mappings.sortOrder);
    }
    return db.select().from(broker_field_mappings)
      .where(eq(broker_field_mappings.brokerName, brokerName))
      .orderBy(broker_field_mappings.sortOrder);
  }

  async getBrokerFieldMappingById(id: number): Promise<BrokerFieldMapping | undefined> {
    const [row] = await db.select().from(broker_field_mappings).where(eq(broker_field_mappings.id, id));
    return row;
  }

  async getBrokerFieldMappingStats(brokerName: string): Promise<{ matched: number; pending: number; gap: number; not_applicable: number; total: number }> {
    const rows = await db.select({
      status: broker_field_mappings.matchStatus,
      count: sql<number>`count(*)::int`,
    }).from(broker_field_mappings)
      .where(eq(broker_field_mappings.brokerName, brokerName))
      .groupBy(broker_field_mappings.matchStatus);
    const stats = { matched: 0, pending: 0, gap: 0, not_applicable: 0, total: 0 };
    for (const r of rows) {
      const key = r.status as keyof typeof stats;
      if (key in stats) stats[key] = r.count;
      stats.total += r.count;
    }
    return stats;
  }

  async upsertBrokerFieldMappings(fields: InsertBrokerFieldMapping[]): Promise<BrokerFieldMapping[]> {
    const results: BrokerFieldMapping[] = [];
    for (const field of fields) {
      const existing = await db.select().from(broker_field_mappings)
        .where(and(
          eq(broker_field_mappings.brokerName, field.brokerName),
          eq(broker_field_mappings.category, field.category),
          eq(broker_field_mappings.fieldCode, field.fieldCode),
          eq(broker_field_mappings.endpoint, field.endpoint || ""),
        ))
        .limit(1);
      if (existing.length > 0) {
        const [updated] = await db.update(broker_field_mappings)
          .set({
            fieldName: field.fieldName,
            fieldType: field.fieldType,
            fieldDescription: field.fieldDescription,
            direction: field.direction,
            universalFieldName: field.universalFieldName,
            matchStatus: field.matchStatus,
            allowedValues: field.allowedValues,
            defaultValue: field.defaultValue,
            isRequired: field.isRequired,
            sortOrder: field.sortOrder,
            notes: field.notes,
          })
          .where(eq(broker_field_mappings.id, existing[0].id))
          .returning();
        results.push(updated);
      } else {
        const [inserted] = await db.insert(broker_field_mappings).values(field).returning();
        results.push(inserted);
      }
    }
    return results;
  }

  async updateBrokerFieldMapping(id: number, data: Partial<InsertBrokerFieldMapping>): Promise<BrokerFieldMapping | undefined> {
    const [updated] = await db.update(broker_field_mappings).set(data).where(eq(broker_field_mappings.id, id)).returning();
    return updated;
  }

  async deleteBrokerFieldMappings(brokerName: string): Promise<number> {
    const deleted = await db.delete(broker_field_mappings).where(eq(broker_field_mappings.brokerName, brokerName)).returning();
    return deleted.length;
  }

  // Universal Fields - PERSISTENT in PostgreSQL
  async getUniversalFields(category?: string): Promise<UniversalField[]> {
    if (category) {
      return db.select().from(universal_fields)
        .where(eq(universal_fields.category, category))
        .orderBy(universal_fields.category, universal_fields.fieldName);
    }
    return db.select().from(universal_fields)
      .orderBy(universal_fields.category, universal_fields.fieldName);
  }

  async getUniversalField(id: number): Promise<UniversalField | undefined> {
    const [field] = await db.select().from(universal_fields).where(eq(universal_fields.id, id)).limit(1);
    return field;
  }

  async createUniversalField(field: InsertUniversalField): Promise<UniversalField> {
    const [created] = await db.insert(universal_fields).values(field).returning();
    return created;
  }

  async updateUniversalField(id: number, data: Partial<InsertUniversalField>): Promise<UniversalField | undefined> {
    const [updated] = await db.update(universal_fields).set(data).where(eq(universal_fields.id, id)).returning();
    return updated;
  }

  async deleteUniversalField(id: number): Promise<boolean> {
    const deleted = await db.delete(universal_fields).where(eq(universal_fields.id, id)).returning();
    return deleted.length > 0;
  }
}

export const storage = new DatabaseStorage();
