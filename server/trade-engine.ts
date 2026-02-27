import type { IStorage } from "./storage";
import type { StrategyPlan, StrategyTrade, StrategyConfig, BrokerConfig, WebhookData, ActionMapperEntry } from "@shared/schema";
import { tradingCache } from "./cache";
import EL from "./el-kotak-neo-v3";
import { placeOrder as placeBinanceOrder, type BinanceSession, type BinanceOrderParams } from "./binance-api";

export interface SignalContext {
  blockType?: string;
  parentExchange?: string | null;
  parentTicker?: string | null;
}

export interface TradeResult {
  success: boolean;
  action: "open" | "close" | "hold" | "error";
  broker: string;
  planId: string;
  trade?: StrategyTrade;
  orderId?: string;
  pnl?: number;
  message: string;
  executionTimeMs?: number;
}

export function resolveSignalFromActionMapper(
  signalData: Record<string, any>,
  actionMapperJson: string | null | undefined
): { signalType: string; blockType: string } {
  let actionMapper: ActionMapperEntry[] = [];
  try {
    actionMapper = JSON.parse(actionMapperJson || "[]");
  } catch {}

  if (actionMapper.length > 0) {
    for (const entry of actionMapper) {
      const fieldKey = entry.fieldKey || "alert";
      const fieldValue = signalData[fieldKey];
      if (fieldValue !== undefined && fieldValue !== null && String(fieldValue) === entry.signalValue) {
        if (entry.uptrend === "ENTRY") return { signalType: "buy", blockType: "uptrendLegs" };
        if (entry.uptrend === "EXIT") return { signalType: "sell", blockType: "uptrendLegs" };
        if (entry.downtrend === "ENTRY") return { signalType: "sell", blockType: "downtrendLegs" };
        if (entry.downtrend === "EXIT") return { signalType: "buy", blockType: "downtrendLegs" };
        if (entry.neutral === "ENTRY") return { signalType: "hold", blockType: "neutralLegs" };
        if (entry.neutral === "EXIT") return { signalType: "hold", blockType: "neutralLegs" };
        if (entry.uptrend === "HOLD" || entry.downtrend === "HOLD" || entry.neutral === "HOLD") {
          return { signalType: "hold", blockType: "neutralLegs" };
        }
      }
    }
  }

  const fallbackType = signalData.signalType || (signalData.actionBinary === 1 ? "buy" : signalData.actionBinary === 0 ? "sell" : "hold");
  return { signalType: fallbackType, blockType: fallbackType === "buy" ? "uptrendLegs" : fallbackType === "sell" ? "downtrendLegs" : "neutralLegs" };
}

function buildBinanceSession(config: BrokerConfig): BinanceSession | null {
  if (!config.consumerKey || !config.consumerSecret) return null;
  return {
    apiKey: config.consumerKey,
    apiSecret: config.consumerSecret,
    isTestnet: config.environment !== "prod",
  };
}

export async function processTradeSignal(
  storage: IStorage,
  webhookData: WebhookData,
  strategyConfigId: string,
  signalContext?: SignalContext
): Promise<TradeResult[]> {
  const results: TradeResult[] = [];

  let plans = tradingCache.getActivePlansByConfigId(strategyConfigId);
  if (!plans) {
    const allPlans = await storage.getStrategyPlansByConfig(strategyConfigId);
    plans = allPlans.filter(p => p.brokerConfigId && p.deploymentStatus === "active");
    tradingCache.setActivePlansByConfigId(strategyConfigId, plans);
  }

  if (plans.length === 0) {
    return [{ success: false, action: "hold", broker: "none", planId: "", message: "No active plans found for this strategy" }];
  }

  const brokerConfigIds = Array.from(new Set(plans.map(p => p.brokerConfigId!)));
  const brokerConfigs = new Map<string, BrokerConfig>();
  for (const bcId of brokerConfigIds) {
    let bc = tradingCache.getBrokerConfig(bcId);
    if (!bc) {
      bc = await storage.getBrokerConfig(bcId) || undefined;
      if (bc) tradingCache.setBrokerConfig(bcId, bc);
    }
    if (bc) brokerConfigs.set(bcId, bc);
  }

  const tradePromises = plans.map(plan => {
    const brokerConfig = brokerConfigs.get(plan.brokerConfigId!);
    if (!brokerConfig) {
      return Promise.resolve<TradeResult>({ success: false, action: "error", broker: "unknown", planId: plan.id, message: "Broker config not found" });
    }
    return executeTradeForPlan(storage, plan, brokerConfig, webhookData, signalContext);
  });

  const settledResults = await Promise.allSettled(tradePromises);
  for (const result of settledResults) {
    if (result.status === "fulfilled") {
      results.push(result.value);
    } else {
      results.push({ success: false, action: "error", broker: "unknown", planId: "", message: result.reason?.message || "Trade execution failed" });
    }
  }

  return results.length > 0 ? results : [{ success: false, action: "hold", broker: "none", planId: "", message: "No broker plans matched" }];
}

async function executeTradeForPlan(
  storage: IStorage,
  plan: StrategyPlan,
  brokerConfig: BrokerConfig,
  data: WebhookData,
  signalContext?: SignalContext
): Promise<TradeResult> {
  const startTime = Date.now();
  const broker = brokerConfig.brokerName;
  const signalType = data.signalType;
  const price = data.price || 0;
  const ticker = data.indices || plan.ticker || signalContext?.parentTicker || "UNKNOWN";
  const exchange = data.exchange || plan.exchange || signalContext?.parentExchange || "NFO";
  const resolvedBlockType = signalContext?.blockType || (signalType === "buy" ? "uptrendLegs" : signalType === "sell" ? "downtrendLegs" : "neutralLegs");
  const now = new Date().toISOString();
  const today = now.split("T")[0];
  const lotMultiplier = plan.lotMultiplier || 1;

  if (signalType === "hold" || !signalType) {
    return { success: true, action: "hold", broker, planId: plan.id, message: "Hold signal — no action taken", executionTimeMs: Date.now() - startTime };
  }

  let openTrades = tradingCache.getOpenTradesByPlanId(plan.id);
  if (!openTrades) {
    openTrades = await storage.getOpenTradesByPlan(plan.id);
    tradingCache.setOpenTradesByPlanId(plan.id, openTrades);
  }

  if (signalType === "buy") {
    return executeBuySignal(storage, plan, brokerConfig, { ticker, exchange, price, resolvedBlockType, lotMultiplier, now, today, data, openTrades, signalContext, startTime });
  }

  if (signalType === "sell") {
    if (plan.awaitingCleanEntry && openTrades.length === 0) {
      return { success: true, action: "hold", broker, planId: plan.id, message: "Awaiting clean entry — no position to sell, skipping", executionTimeMs: Date.now() - startTime };
    }
    return executeSellSignal(storage, plan, brokerConfig, { ticker, exchange, price, resolvedBlockType, lotMultiplier, now, today, data, openTrades, signalContext, startTime });
  }

  return { success: false, action: "error", broker, planId: plan.id, message: `Unknown signal type: ${signalType}`, executionTimeMs: Date.now() - startTime };
}

interface TradeContext {
  ticker: string;
  exchange: string;
  price: number;
  resolvedBlockType: string;
  lotMultiplier: number;
  now: string;
  today: string;
  data: WebhookData;
  openTrades: StrategyTrade[];
  signalContext?: SignalContext;
  startTime: number;
}

async function executeBuySignal(
  storage: IStorage,
  plan: StrategyPlan,
  brokerConfig: BrokerConfig,
  ctx: TradeContext
): Promise<TradeResult> {
  const broker = brokerConfig.brokerName;

  const existingBuy = ctx.openTrades.find(t => t.action === "BUY");
  if (existingBuy) {
    return { success: true, action: "hold", broker, planId: plan.id, message: "Buy position already open — holding", executionTimeMs: Date.now() - ctx.startTime };
  }

  const openSell = ctx.openTrades.find(t => t.action === "SELL");
  if (openSell) {
    const closedTrade = await closeTrade(storage, openSell, ctx.price, ctx.now);
    deferDailyPnlUpdate(storage, plan.id, ctx.today, closedTrade.pnl || 0);
  }

  const quantity = ctx.lotMultiplier;
  let orderId: string | undefined;
  let productType = "PAPER";

  if (broker === "kotak_neo") {
    if (!brokerConfig.isConnected || !brokerConfig.accessToken || !brokerConfig.sessionId || !brokerConfig.baseUrl) {
      return { success: false, action: "error", broker, planId: plan.id, message: "Kotak Neo session expired or not connected", executionTimeMs: Date.now() - ctx.startTime };
    }

    const orderResult = await EL.placeOrder(brokerConfig, {
      tradingSymbol: ctx.ticker,
      exchangeSegment: EL.mapExchange(ctx.exchange),
      transactionType: "B",
      quantity: String(quantity),
      price: "0",
      priceType: "MKT",
      productCode: "MIS",
      validity: "DAY",
      afterMarketOrder: "NO",
      disclosedQuantity: "0",
      marketProtection: "0",
      priceFillFlag: "N",
      triggerPrice: "0",
    });

    if (!orderResult.success) {
      return { success: false, action: "error", broker, planId: plan.id, message: `Kotak Neo order failed: ${orderResult.error}`, executionTimeMs: Date.now() - ctx.startTime };
    }
    orderId = orderResult.data?.orderNo;
    productType = "MIS";
  } else if (broker === "binance") {
    const session = buildBinanceSession(brokerConfig);
    if (!session) return { success: false, action: "error", broker, planId: plan.id, message: "Binance credentials missing", executionTimeMs: Date.now() - ctx.startTime };

    const orderResult = await placeBinanceOrder(session, {
      symbol: ctx.ticker.replace("-", "").replace("/", ""),
      side: "BUY",
      type: "MARKET",
      quantity,
    });

    if (!orderResult.success) {
      return { success: false, action: "error", broker, planId: plan.id, message: `Binance order failed: ${orderResult.error}`, executionTimeMs: Date.now() - ctx.startTime };
    }
    orderId = orderResult.data?.orderNo;
    productType = "SPOT";
  } else {
    orderId = `PT-${Date.now()}`;
    productType = "PAPER";
  }

  const trade = await storage.createStrategyTrade({
    planId: plan.id,
    orderId: orderId || `${broker.toUpperCase()}-${Date.now()}`,
    tradingSymbol: ctx.ticker,
    exchange: ctx.exchange,
    quantity,
    price: ctx.price,
    action: "BUY",
    blockType: ctx.resolvedBlockType,
    legIndex: 0,
    orderType: "MKT",
    productType,
    status: "open",
    pnl: 0,
    ltp: ctx.price,
    executedAt: ctx.now,
    createdAt: ctx.now,
    updatedAt: ctx.now,
    timeUnix: ctx.data.timeUnix || null,
    ticker: ctx.data.indices || ctx.ticker,
    indicator: ctx.data.indicator || null,
    alert: ctx.data.alert || null,
    localTime: ctx.data.localTime || null,
    mode: ctx.data.mode || null,
    modeDesc: ctx.data.modeDesc || null,
  });

  tradingCache.invalidateOpenTrades(plan.id);

  if (plan.awaitingCleanEntry) {
    await storage.updateStrategyPlan(plan.id, { awaitingCleanEntry: false });
    if (plan.configId) tradingCache.invalidatePlans(plan.configId);
  }

  return {
    success: true,
    action: "open",
    broker,
    planId: plan.id,
    trade,
    orderId,
    message: `${broker.toUpperCase()} BUY: ${quantity} ${ctx.ticker} @ ${ctx.price} [${ctx.resolvedBlockType}]`,
    executionTimeMs: Date.now() - ctx.startTime,
  };
}

async function executeSellSignal(
  storage: IStorage,
  plan: StrategyPlan,
  brokerConfig: BrokerConfig,
  ctx: TradeContext
): Promise<TradeResult> {
  const broker = brokerConfig.brokerName;
  let closePnl = 0;

  const existingBuyToClose = ctx.openTrades.find(t => t.action === "BUY");
  if (existingBuyToClose) {
    const closedTrade = await closeTrade(storage, existingBuyToClose, ctx.price, ctx.now);
    closePnl = closedTrade.pnl || 0;
    deferDailyPnlUpdate(storage, plan.id, ctx.today, closePnl);
  }

  const existingSell = ctx.openTrades.find(t => t.action === "SELL");
  if (existingSell) {
    return { success: true, action: "hold", broker, planId: plan.id, message: "Sell position already open — holding", pnl: closePnl, executionTimeMs: Date.now() - ctx.startTime };
  }

  const quantity = ctx.lotMultiplier;
  let orderId: string | undefined;
  let productType = "PAPER";

  if (broker === "kotak_neo") {
    if (!brokerConfig.isConnected || !brokerConfig.accessToken || !brokerConfig.sessionId || !brokerConfig.baseUrl) {
      return { success: false, action: "error", broker, planId: plan.id, message: "Kotak Neo session expired or not connected", executionTimeMs: Date.now() - ctx.startTime };
    }

    const orderResult = await EL.placeOrder(brokerConfig, {
      tradingSymbol: ctx.ticker,
      exchangeSegment: EL.mapExchange(ctx.exchange),
      transactionType: "S",
      quantity: String(quantity),
      price: "0",
      priceType: "MKT",
      productCode: "MIS",
      validity: "DAY",
      afterMarketOrder: "NO",
      disclosedQuantity: "0",
      marketProtection: "0",
      priceFillFlag: "N",
      triggerPrice: "0",
    });

    if (!orderResult.success) {
      return { success: false, action: "error", broker, planId: plan.id, message: `Kotak Neo order failed: ${orderResult.error}`, executionTimeMs: Date.now() - ctx.startTime };
    }
    orderId = orderResult.data?.orderNo;
    productType = "MIS";
  } else if (broker === "binance") {
    const session = buildBinanceSession(brokerConfig);
    if (!session) return { success: false, action: "error", broker, planId: plan.id, message: "Binance credentials missing", executionTimeMs: Date.now() - ctx.startTime };

    const orderResult = await placeBinanceOrder(session, {
      symbol: ctx.ticker.replace("-", "").replace("/", ""),
      side: "SELL",
      type: "MARKET",
      quantity,
    });

    if (!orderResult.success) {
      return { success: false, action: "error", broker, planId: plan.id, message: `Binance order failed: ${orderResult.error}`, executionTimeMs: Date.now() - ctx.startTime };
    }
    orderId = orderResult.data?.orderNo;
    productType = "SPOT";
  } else {
    orderId = `PT-${Date.now()}`;
    productType = "PAPER";
  }

  const trade = await storage.createStrategyTrade({
    planId: plan.id,
    orderId: orderId || `${broker.toUpperCase()}-${Date.now()}`,
    tradingSymbol: ctx.ticker,
    exchange: ctx.exchange,
    quantity,
    price: ctx.price,
    action: "SELL",
    blockType: ctx.resolvedBlockType,
    legIndex: 0,
    orderType: "MKT",
    productType,
    status: "open",
    pnl: 0,
    ltp: ctx.price,
    executedAt: ctx.now,
    createdAt: ctx.now,
    updatedAt: ctx.now,
    timeUnix: ctx.data.timeUnix || null,
    ticker: ctx.data.indices || ctx.ticker,
    indicator: ctx.data.indicator || null,
    alert: ctx.data.alert || null,
    localTime: ctx.data.localTime || null,
    mode: ctx.data.mode || null,
    modeDesc: ctx.data.modeDesc || null,
  });

  tradingCache.invalidateOpenTrades(plan.id);

  return {
    success: true,
    action: "open",
    broker,
    planId: plan.id,
    trade,
    orderId,
    pnl: closePnl,
    message: `${broker.toUpperCase()} SELL: ${quantity} ${ctx.ticker} @ ${ctx.price} [${ctx.resolvedBlockType}]`,
    executionTimeMs: Date.now() - ctx.startTime,
  };
}

async function closeTrade(
  storage: IStorage,
  trade: StrategyTrade,
  exitPrice: number,
  now: string
): Promise<StrategyTrade> {
  const entryPrice = trade.price || 0;
  const qty = trade.quantity || 1;
  const pnl = trade.action === "BUY"
    ? (exitPrice - entryPrice) * qty
    : (entryPrice - exitPrice) * qty;

  const exitAction = trade.action === "BUY" ? "SELL" : "BUY";

  const updated = await storage.updateStrategyTrade(trade.id, {
    status: "closed",
    pnl: Math.round(pnl * 100) / 100,
    ltp: exitPrice,
    exitPrice,
    exitAction,
    exitedAt: now,
    updatedAt: now,
  });

  return updated || trade;
}

function deferDailyPnlUpdate(
  storage: IStorage,
  planId: string,
  date: string,
  tradePnl: number
): void {
  setImmediate(async () => {
    try {
      const existingEntries = await storage.getStrategyDailyPnl(planId);
      const todayEntry = existingEntries.find(e => e.date === date);
      const allTrades = await storage.getStrategyTradesByPlan(planId);
      const openCount = allTrades.filter(t => t.status === "open" || t.status === "pending").length;
      const closedCount = allTrades.filter(t => t.status === "closed").length;
      const totalTradesCount = allTrades.length;
      const cumulativePnl = allTrades.filter(t => t.status === "closed").reduce((sum, t) => sum + (t.pnl || 0), 0);

      if (todayEntry) {
        await storage.updateStrategyDailyPnl(todayEntry.id, {
          dailyPnl: (todayEntry.dailyPnl || 0) + tradePnl,
          cumulativePnl: Math.round(cumulativePnl * 100) / 100,
          tradesCount: totalTradesCount,
          openTrades: openCount,
          closedTrades: closedCount,
        });
      } else {
        await storage.createStrategyDailyPnl({
          planId,
          date,
          dailyPnl: Math.round(tradePnl * 100) / 100,
          cumulativePnl: Math.round(cumulativePnl * 100) / 100,
          tradesCount: totalTradesCount,
          openTrades: openCount,
          closedTrades: closedCount,
          status: "active",
          createdAt: new Date().toISOString(),
        });
      }
    } catch (err) {
      console.error("Deferred daily P&L update error:", err);
    }
  });
}
