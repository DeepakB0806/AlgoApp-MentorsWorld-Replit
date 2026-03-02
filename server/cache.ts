import type { Webhook, StrategyConfig, BrokerConfig, StrategyPlan, InstrumentConfig } from "@shared/schema";
import type { IStorage } from "./storage";

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const HOT_PATH_TTL_MS = 120_000; // 2 minutes for production hot data (webhooks, configs)
const BROKER_SESSION_TTL_MS = 300_000; // 5 minutes for broker sessions
const OPEN_TRADES_TTL_MS = 10_000; // 10 seconds for open trades

class TradingCache {
  private webhooks = new Map<string, CacheEntry<Webhook>>();
  private configsByWebhookId = new Map<string, CacheEntry<StrategyConfig | null>>();
  private configsById = new Map<string, CacheEntry<StrategyConfig>>();
  private brokerConfigs = new Map<string, CacheEntry<BrokerConfig>>();
  private activePlansByConfigId = new Map<string, CacheEntry<StrategyPlan[]>>();
  private openTradesByPlanId = new Map<string, CacheEntry<any[]>>();
  private instrumentConfigs = new Map<string, CacheEntry<InstrumentConfig>>();

  private isValid<T>(entry: CacheEntry<T> | undefined): entry is CacheEntry<T> {
    return !!entry && Date.now() < entry.expiresAt;
  }

  getWebhook(id: string): Webhook | undefined {
    const entry = this.webhooks.get(id);
    return this.isValid(entry) ? entry.data : undefined;
  }

  setWebhook(id: string, webhook: Webhook): void {
    this.webhooks.set(id, { data: webhook, expiresAt: Date.now() + HOT_PATH_TTL_MS });
  }

  getConfigByWebhookId(webhookId: string): StrategyConfig | null | undefined {
    const entry = this.configsByWebhookId.get(webhookId);
    if (!this.isValid(entry)) return undefined;
    return entry.data;
  }

  setConfigByWebhookId(webhookId: string, config: StrategyConfig | null): void {
    this.configsByWebhookId.set(webhookId, { data: config, expiresAt: Date.now() + HOT_PATH_TTL_MS });
  }

  getConfigById(id: string): StrategyConfig | undefined {
    const entry = this.configsById.get(id);
    return this.isValid(entry) ? entry.data : undefined;
  }

  setConfigById(id: string, config: StrategyConfig): void {
    this.configsById.set(id, { data: config, expiresAt: Date.now() + HOT_PATH_TTL_MS });
  }

  getBrokerConfig(id: string): BrokerConfig | undefined {
    const entry = this.brokerConfigs.get(id);
    return this.isValid(entry) ? entry.data : undefined;
  }

  setBrokerConfig(id: string, config: BrokerConfig): void {
    this.brokerConfigs.set(id, { data: config, expiresAt: Date.now() + BROKER_SESSION_TTL_MS });
  }

  getActivePlansByConfigId(configId: string): StrategyPlan[] | undefined {
    const entry = this.activePlansByConfigId.get(configId);
    return this.isValid(entry) ? entry.data : undefined;
  }

  setActivePlansByConfigId(configId: string, plans: StrategyPlan[]): void {
    this.activePlansByConfigId.set(configId, { data: plans, expiresAt: Date.now() + HOT_PATH_TTL_MS });
  }

  getOpenTradesByPlanId(planId: string): any[] | undefined {
    const entry = this.openTradesByPlanId.get(planId);
    return this.isValid(entry) ? entry.data : undefined;
  }

  setOpenTradesByPlanId(planId: string, trades: any[]): void {
    this.openTradesByPlanId.set(planId, { data: trades, expiresAt: Date.now() + OPEN_TRADES_TTL_MS });
  }

  invalidateOpenTrades(planId: string): void {
    this.openTradesByPlanId.delete(planId);
  }

  getInstrumentConfig(ticker: string, exchange: string): InstrumentConfig | undefined {
    const key = `${ticker}:${exchange}`;
    const entry = this.instrumentConfigs.get(key);
    return this.isValid(entry) ? entry.data : undefined;
  }

  setInstrumentConfig(ticker: string, exchange: string, config: InstrumentConfig): void {
    const key = `${ticker}:${exchange}`;
    this.instrumentConfigs.set(key, { data: config, expiresAt: Date.now() + HOT_PATH_TTL_MS });
  }

  invalidateInstrumentConfigs(): void {
    this.instrumentConfigs.clear();
  }

  invalidateWebhook(id: string): void {
    this.webhooks.delete(id);
  }

  invalidateConfig(id: string): void {
    this.configsById.delete(id);
    const keysToDelete: string[] = [];
    this.configsByWebhookId.forEach((entry, webhookId) => {
      if (entry.data && entry.data.id === id) {
        keysToDelete.push(webhookId);
      }
    });
    keysToDelete.forEach(k => this.configsByWebhookId.delete(k));
  }

  invalidateBrokerConfig(id: string): void {
    this.brokerConfigs.delete(id);
  }

  invalidatePlans(configId: string): void {
    this.activePlansByConfigId.delete(configId);
  }

  invalidateAll(): void {
    this.webhooks.clear();
    this.configsByWebhookId.clear();
    this.configsById.clear();
    this.brokerConfigs.clear();
    this.activePlansByConfigId.clear();
    this.openTradesByPlanId.clear();
    this.instrumentConfigs.clear();
  }

  async warmUp(storage: IStorage): Promise<void> {
    try {
      const startTime = Date.now();

      const [webhooks, configs, brokerConfigs] = await Promise.all([
        storage.getWebhooks(),
        storage.getStrategyConfigs(),
        storage.getBrokerConfigs(),
      ]);

      for (const wh of webhooks) {
        if (wh.isActive) this.setWebhook(wh.id, wh);
      }

      for (const cfg of configs) {
        this.setConfigById(cfg.id, cfg);
        if (cfg.webhookId) this.setConfigByWebhookId(cfg.webhookId, cfg);
      }

      for (const bc of brokerConfigs) {
        this.setBrokerConfig(bc.id, bc);
      }

      for (const cfg of configs) {
        try {
          const plans = await storage.getStrategyPlansByConfig(cfg.id);
          const activePlans = plans.filter(p => p.brokerConfigId && p.deploymentStatus === "active");
          if (activePlans.length > 0) {
            this.setActivePlansByConfigId(cfg.id, activePlans);
          }
        } catch {}
      }

      console.log(`[CACHE] Warmed up in ${Date.now() - startTime}ms: ${webhooks.length} webhooks, ${configs.length} configs, ${brokerConfigs.length} broker configs`);
    } catch (err) {
      console.error("[CACHE] Warm-up failed:", err);
    }
  }
}

export const tradingCache = new TradingCache();
