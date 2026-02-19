import type { IStorage } from "./storage";
import type { StrategyPlan, StrategyTrade, WebhookData } from "@shared/schema";

interface PaperTradeResult {
  success: boolean;
  action: "open" | "close" | "hold" | "error";
  trade?: StrategyTrade;
  pnl?: number;
  message: string;
}

export async function processPaperTrade(
  storage: IStorage,
  webhookDataEntry: WebhookData,
  strategyConfigId: string
): Promise<PaperTradeResult[]> {
  const results: PaperTradeResult[] = [];

  const plans = await storage.getStrategyPlansByConfig(strategyConfigId);
  const activePlansWithBroker = plans.filter(
    (p) => p.brokerConfigId && p.deploymentStatus === "active"
  );

  if (activePlansWithBroker.length === 0) {
    return [{ success: false, action: "hold", message: "No active plans found for this strategy" }];
  }

  for (const plan of activePlansWithBroker) {
    const brokerConfig = await storage.getBrokerConfig(plan.brokerConfigId!);
    if (!brokerConfig || brokerConfig.brokerName !== "paper_trade") {
      continue;
    }

    const result = await executePaperTradeForPlan(storage, plan, webhookDataEntry);
    results.push(result);
  }

  if (results.length === 0) {
    return [{ success: false, action: "hold", message: "No paper trade broker plans matched" }];
  }

  return results;
}

async function executePaperTradeForPlan(
  storage: IStorage,
  plan: StrategyPlan,
  data: WebhookData
): Promise<PaperTradeResult> {
  const signalType = data.signalType;
  const price = data.price || 0;
  const ticker = data.indices || plan.ticker || "UNKNOWN";
  const exchange = data.exchange || plan.exchange || "PAPER";
  const now = new Date().toISOString();
  const today = now.split("T")[0];
  const lotMultiplier = plan.lotMultiplier || 1;

  if (signalType === "hold" || !signalType) {
    return { success: true, action: "hold", message: "Hold signal — no action taken" };
  }

  const existingTrades = await storage.getStrategyTradesByPlan(plan.id);
  const openTrades = existingTrades.filter((t) => t.status === "open" || t.status === "pending");

  if (signalType === "buy") {
    const existingBuy = openTrades.find((t) => t.action === "BUY");
    if (existingBuy) {
      return { success: true, action: "hold", message: "Buy position already open — holding" };
    }

    const openSell = openTrades.find((t) => t.action === "SELL");
    if (openSell) {
      const closedTrade = await closePaperTrade(storage, openSell, price, now);
      await updateDailyPnl(storage, plan.id, today, closedTrade.pnl || 0);
    }

    const quantity = lotMultiplier;
    const trade = await storage.createStrategyTrade({
      planId: plan.id,
      orderId: `PT-${Date.now()}`,
      tradingSymbol: ticker,
      exchange,
      quantity,
      price,
      action: "BUY",
      blockType: "uptrendLegs",
      legIndex: 0,
      orderType: "MKT",
      productType: "PAPER",
      status: "open",
      pnl: 0,
      ltp: price,
      executedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    return { success: true, action: "open", trade, message: `Paper BUY: ${quantity} ${ticker} @ ${price}` };
  }

  if (signalType === "sell") {
    const existingBuyToClose = openTrades.find((t) => t.action === "BUY");
    let closePnl = 0;

    if (existingBuyToClose) {
      const closedTrade = await closePaperTrade(storage, existingBuyToClose, price, now);
      closePnl = closedTrade.pnl || 0;
      await updateDailyPnl(storage, plan.id, today, closePnl);
    }

    const existingSell = openTrades.find((t) => t.action === "SELL");
    if (existingSell) {
      return { success: true, action: "hold", message: "Sell position already open — holding", pnl: closePnl };
    }

    const quantity = lotMultiplier;
    const trade = await storage.createStrategyTrade({
      planId: plan.id,
      orderId: `PT-${Date.now()}`,
      tradingSymbol: ticker,
      exchange,
      quantity,
      price,
      action: "SELL",
      blockType: "downtrendLegs",
      legIndex: 0,
      orderType: "MKT",
      productType: "PAPER",
      status: "open",
      pnl: 0,
      ltp: price,
      executedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    return { success: true, action: "open", trade, pnl: closePnl, message: `Paper SELL: ${quantity} ${ticker} @ ${price}` };
  }

  return { success: false, action: "error", message: `Unknown signal type: ${signalType}` };
}

async function closePaperTrade(
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

  const updated = await storage.updateStrategyTrade(trade.id, {
    status: "closed",
    pnl: Math.round(pnl * 100) / 100,
    ltp: exitPrice,
    updatedAt: now,
  });

  return updated || trade;
}

async function updateDailyPnl(
  storage: IStorage,
  planId: string,
  date: string,
  tradePnl: number
): Promise<void> {
  const existingEntries = await storage.getStrategyDailyPnl(planId);
  const todayEntry = existingEntries.find((e) => e.date === date);
  const allTrades = await storage.getStrategyTradesByPlan(planId);
  const openCount = allTrades.filter((t) => t.status === "open" || t.status === "pending").length;
  const closedCount = allTrades.filter((t) => t.status === "closed").length;
  const totalTradesCount = allTrades.length;

  const cumulativePnl = allTrades
    .filter((t) => t.status === "closed")
    .reduce((sum, t) => sum + (t.pnl || 0), 0);

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
}
