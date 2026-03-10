// ═══════════════════════════════════════════════════════════════════════════════
// IMPORTS
// ═══════════════════════════════════════════════════════════════════════════════
import type { IStorage } from "./storage";
import type {
  StrategyPlan,
  StrategyTrade,
  StrategyConfig,
  BrokerConfig,
  WebhookData,
  ActionMapperEntry,
  PlanTradeLeg,
  InstrumentConfig,
} from "@shared/schema";
import { tradingCache } from "./cache";
import EL from "./el-kotak-neo-v3";
import { addProcessFlowLog } from "./process-flow-log";
import TL from "./tl-kotak-neo-v3";
import {
  placeOrder as placeBinanceOrder,
  type BinanceSession,
  type BinanceOrderParams,
} from "./binance-api";
import {
  buildKotakOptionSymbol,
  isOptionExchange,
  isStrikeSpec,
} from "./option-symbol-builder";

// ═══════════════════════════════════════════════════════════════════════════════
// TRANSACTION TYPE MAPPING
// Maps universal action names (BUY/SELL) to broker-specific codes via TL
// ═══════════════════════════════════════════════════════════════════════════════
function mapTransactionType(action: string): string {
  if (TL.isReady()) {
    const mapped = TL.mapValueFromAllowed(
      "transactionType",
      "order_place",
      action,
    );
    if (mapped) return mapped;
    console.error(
      `[TE] Transaction type mapping not found in DB for action="${action}" — check broker_field_mappings.allowed_values for transactionType`,
    );
  } else {
    console.warn(
      `[TE] TL not ready — cannot map transaction type for action="${action}"`,
    );
  }
  return action;
}

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES & INTERFACES
// ═══════════════════════════════════════════════════════════════════════════════
export interface SignalContext {
  blockType?: string;
  resolvedAction?: "ENTRY" | "EXIT" | "HOLD";
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

export type ResolvedSignal = {
  signalType: string;
  blockType: string;
  resolvedAction: "ENTRY" | "EXIT" | "HOLD";
};

// ═══════════════════════════════════════════════════════════════════════════════
// SIGNAL RESOLUTION
// Resolves webhook alert strings into ENTRY/EXIT/HOLD actions using actionMapper
// ═══════════════════════════════════════════════════════════════════════════════
export function resolveSignalFromActionMapper(
  signalData: Record<string, any>,
  actionMapperJson: string | null | undefined,
): ResolvedSignal {
  const results = resolveAllSignalsFromActionMapper(
    signalData,
    actionMapperJson,
  );
  return results[0];
}

export function resolveAllSignalsFromActionMapper(
  signalData: Record<string, any>,
  actionMapperJson: string | null | undefined,
): ResolvedSignal[] {
  let actionMapper: ActionMapperEntry[] = [];
  try {
    actionMapper = JSON.parse(actionMapperJson || "[]");
  } catch {}

  if (actionMapper.length > 0) {
    for (const entry of actionMapper) {
      const fieldKey = entry.fieldKey || "alert";
      const fieldValue = signalData[fieldKey];
      if (
        fieldValue !== undefined &&
        fieldValue !== null &&
        String(fieldValue) === entry.signalValue
      ) {
        const actions: ResolvedSignal[] = [];

        if (entry.uptrend === "EXIT")
          actions.push({
            signalType: "sell",
            blockType: "uptrendLegs",
            resolvedAction: "EXIT",
          });
        if (entry.downtrend === "EXIT")
          actions.push({
            signalType: "sell",
            blockType: "downtrendLegs",
            resolvedAction: "EXIT",
          });
        if (entry.neutral === "EXIT")
          actions.push({
            signalType: "sell",
            blockType: "neutralLegs",
            resolvedAction: "EXIT",
          });

        if (entry.uptrend === "ENTRY")
          actions.push({
            signalType: "buy",
            blockType: "uptrendLegs",
            resolvedAction: "ENTRY",
          });
        if (entry.downtrend === "ENTRY")
          actions.push({
            signalType: "buy",
            blockType: "downtrendLegs",
            resolvedAction: "ENTRY",
          });
        if (entry.neutral === "ENTRY")
          actions.push({
            signalType: "buy",
            blockType: "neutralLegs",
            resolvedAction: "ENTRY",
          });

        if (actions.length > 0) {
          console.log(
            `[SIGNAL] Resolved ${actions.length} action(s) for signal "${fieldValue}": ${actions.map((a) => `${a.resolvedAction}@${a.blockType}`).join(", ")}`,
          );
          return actions;
        }

        if (
          entry.uptrend === "HOLD" ||
          entry.downtrend === "HOLD" ||
          entry.neutral === "HOLD"
        ) {
          return [
            {
              signalType: "hold",
              blockType: "neutralLegs",
              resolvedAction: "HOLD",
            },
          ];
        }
      }
    }
  }

  const fallbackType =
    signalData.signalType ||
    (signalData.actionBinary === 1
      ? "buy"
      : signalData.actionBinary === 0
        ? "sell"
        : "hold");
  const fallbackAction =
    fallbackType === "buy"
      ? "ENTRY"
      : fallbackType === "sell"
        ? "EXIT"
        : "HOLD";
  return [
    {
      signalType: fallbackType,
      blockType:
        fallbackType === "buy"
          ? "uptrendLegs"
          : fallbackType === "sell"
            ? "downtrendLegs"
            : "neutralLegs",
      resolvedAction: fallbackAction as "ENTRY" | "EXIT" | "HOLD",
    },
  ];
}

// ═══════════════════════════════════════════════════════════════════════════════
// BINANCE HELPER
// ═══════════════════════════════════════════════════════════════════════════════
function buildBinanceSession(config: BrokerConfig): BinanceSession | null {
  if (!config.consumerKey || !config.consumerSecret) return null;
  return {
    apiKey: config.consumerKey,
    apiSecret: config.consumerSecret,
    isTestnet: config.environment !== "prod",
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN ENTRY POINT
// Finds active plans for a config, loads broker configs, dispatches to executors
// ═══════════════════════════════════════════════════════════════════════════════
export async function processTradeSignal(
  storage: IStorage,
  webhookData: WebhookData,
  strategyConfigId: string,
  signalContext?: SignalContext,
): Promise<TradeResult[]> {
  console.log(
    `[PFL] ▶ processTradeSignal: signal=${webhookData.signalType} alert=${webhookData.alert} config=${strategyConfigId.slice(0, 8)} resolvedAction=${signalContext?.resolvedAction || "N/A"} blockType=${signalContext?.blockType || "N/A"}`,
  );
  const results: TradeResult[] = [];

  let plans = tradingCache.getActivePlansByConfigId(strategyConfigId);
  if (!plans) {
    const allPlans = await storage.getStrategyPlansByConfig(strategyConfigId);
    plans = allPlans.filter(
      (p) => p.brokerConfigId && p.deploymentStatus === "active",
    );
    tradingCache.setActivePlansByConfigId(strategyConfigId, plans);
  }

  if (plans.length === 0) {
    console.log(
      `[PFL] ✗ No active plans found for config ${strategyConfigId.slice(0, 8)}`,
    );
    return [
      {
        success: false,
        action: "hold",
        broker: "none",
        planId: "",
        message: "No active plans found for this strategy",
      },
    ];
  }
  console.log(
    `[PFL] Found ${plans.length} active plan(s): ${plans.map((p) => `${p.name}[${p.id.slice(0, 8)}]`).join(", ")}`,
  );

  const brokerConfigIds = Array.from(
    new Set(plans.map((p) => p.brokerConfigId!)),
  );
  const brokerConfigs = new Map<string, BrokerConfig>();
  for (const bcId of brokerConfigIds) {
    let bc = tradingCache.getBrokerConfig(bcId);
    if (!bc) {
      bc = (await storage.getBrokerConfig(bcId)) || undefined;
      if (bc) tradingCache.setBrokerConfig(bcId, bc);
    }
    if (bc) brokerConfigs.set(bcId, bc);
  }

  const tradePromises = plans.map((plan) => {
    const brokerConfig = brokerConfigs.get(plan.brokerConfigId!);
    if (!brokerConfig) {
      return Promise.resolve<TradeResult>({
        success: false,
        action: "error",
        broker: "unknown",
        planId: plan.id,
        message: "Broker config not found",
      });
    }
    return executeTradeForPlan(
      storage,
      plan,
      brokerConfig,
      webhookData,
      signalContext,
    );
  });

  const settledResults = await Promise.allSettled(tradePromises);
  for (const result of settledResults) {
    if (result.status === "fulfilled") {
      results.push(result.value);
    } else {
      results.push({
        success: false,
        action: "error",
        broker: "unknown",
        planId: "",
        message: result.reason?.message || "Trade execution failed",
      });
    }
  }

  return results.length > 0
    ? results
    : [
        {
          success: false,
          action: "hold",
          broker: "none",
          planId: "",
          message: "No broker plans matched",
        },
      ];
}

// ═══════════════════════════════════════════════════════════════════════════════
// PLAN HELPERS
// Extract trade params, select legs by blockType, get block config, log PFL
// ═══════════════════════════════════════════════════════════════════════════════
function parseTradeParams(plan: StrategyPlan): Record<string, any> | null {
  if (!plan.tradeParams) return null;
  try {
    return typeof plan.tradeParams === "string"
      ? JSON.parse(plan.tradeParams)
      : plan.tradeParams;
  } catch {
    return null;
  }
}

function selectLegs(
  tradeParams: Record<string, any> | null,
  blockType: string,
): PlanTradeLeg[] {
  if (!tradeParams) return [];
  const legs = tradeParams[blockType];
  if (Array.isArray(legs) && legs.length > 0) return legs;
  if (Array.isArray(tradeParams.legs) && tradeParams.legs.length > 0)
    return tradeParams.legs;
  return [];
}

function getBlockConfig(
  tradeParams: Record<string, any> | null,
  blockType: string,
): Record<string, any> {
  if (!tradeParams) return {};
  const configKey = blockType.replace("Legs", "Config");
  return tradeParams[configKey] || {};
}

function logPFL(
  plan: StrategyPlan,
  broker: string,
  data: WebhookData,
  actionTaken: string,
  message: string,
  extra?: Partial<{
    resolvedAction: string;
    blockType: string;
    ticker: string;
    exchange: string;
    price: number;
    orderId: string;
    executionTimeMs: number;
  }>,
) {
  addProcessFlowLog({
    planId: plan.id,
    planName: plan.name,
    signalType: data.signalType || "unknown",
    alert: data.alert || "",
    resolvedAction: extra?.resolvedAction || "N/A",
    blockType: extra?.blockType || "",
    actionTaken,
    message,
    broker,
    ticker: extra?.ticker,
    exchange: extra?.exchange,
    price: extra?.price,
    orderId: extra?.orderId,
    executionTimeMs: extra?.executionTimeMs,
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// TRADE ROUTING
// Loads instrument config, checks open trades, routes to buy/sell executors
// ═══════════════════════════════════════════════════════════════════════════════
async function executeTradeForPlan(
  storage: IStorage,
  plan: StrategyPlan,
  brokerConfig: BrokerConfig,
  data: WebhookData,
  signalContext?: SignalContext,
): Promise<TradeResult> {
  const startTime = Date.now();
  const broker = brokerConfig.brokerName;
  const signalType = data.signalType;
  const price = Number(data.price) || 0;
  const ticker =
    plan.ticker || data.indices || signalContext?.parentTicker || "UNKNOWN";
  const exchange =
    plan.exchange || data.exchange || signalContext?.parentExchange;
  const resolvedAction = signalContext?.resolvedAction || "N/A";
  console.log(
    `[PFL] ── Plan "${plan.name}" [${plan.id.slice(0, 8)}] | broker=${broker} signal=${signalType} alert=${data.alert} action=${resolvedAction} ticker=${ticker} exchange=${exchange || "NONE"} price=${price}`,
  );
  if (!exchange) {
    console.log(
      `[PFL] ✗ Plan "${plan.name}" — NO EXCHANGE configured (plan/webhook/parent all empty)`,
    );
    logPFL(
      plan,
      broker,
      data,
      "error",
      "No exchange configured — set exchange on strategy plan, webhook data, or parent signal",
      {
        resolvedAction,
        ticker,
        price,
        executionTimeMs: Date.now() - startTime,
      },
    );
    return {
      success: false,
      action: "error",
      broker,
      planId: plan.id,
      message:
        "No exchange configured — set exchange on strategy plan, webhook data, or parent signal",
      executionTimeMs: Date.now() - startTime,
    };
  }
  const resolvedBlockType =
    signalContext?.blockType ||
    (signalType === "buy"
      ? "uptrendLegs"
      : signalType === "sell"
        ? "downtrendLegs"
        : "neutralLegs");
  const now = new Date().toISOString();
  const today = now.split("T")[0];
  const lotMultiplier = plan.lotMultiplier || 1;

  if (signalType === "hold" || !signalType) {
    console.log(`[PFL] ⏸ Plan "${plan.name}" — HOLD signal, no action taken`);
    logPFL(plan, broker, data, "hold", "Hold signal — no action taken", {
      resolvedAction,
      blockType: resolvedBlockType,
      ticker,
      exchange,
      price,
      executionTimeMs: Date.now() - startTime,
    });
    return {
      success: true,
      action: "hold",
      broker,
      planId: plan.id,
      message: "Hold signal — no action taken",
      executionTimeMs: Date.now() - startTime,
    };
  }

  const tradeParams = parseTradeParams(plan);
  const legs = selectLegs(tradeParams, resolvedBlockType);
  const blockConfig = getBlockConfig(tradeParams, resolvedBlockType);

  if (legs.length === 0) {
    console.log(
      `[PFL] ⏸ Plan "${plan.name}" — No legs found for ${resolvedBlockType}, holding`,
    );
    logPFL(
      plan,
      broker,
      data,
      "hold",
      `No legs configured for ${resolvedBlockType}`,
      {
        resolvedAction,
        blockType: resolvedBlockType,
        ticker,
        exchange,
        price,
        executionTimeMs: Date.now() - startTime,
      },
    );
    return {
      success: true,
      action: "hold",
      broker,
      planId: plan.id,
      message: `No legs configured for ${resolvedBlockType}`,
      executionTimeMs: Date.now() - startTime,
    };
  }
  console.log(
    `[PFL] Plan "${plan.name}" — ${legs.length} leg(s) found for ${resolvedBlockType}: ${legs.map((l, i) => `L${i}:${l.type}/${l.strike}/${l.action}`).join(", ")}`,
  );

  let instrumentConfig: InstrumentConfig | undefined;
  if (isOptionExchange(exchange)) {
    instrumentConfig = tradingCache.getInstrumentConfig(ticker, exchange);
    if (!instrumentConfig) {
      instrumentConfig = await storage.getInstrumentConfig(ticker, exchange);
      if (instrumentConfig)
        tradingCache.setInstrumentConfig(ticker, exchange, instrumentConfig);
    }
    if (instrumentConfig) {
      console.log(
        `[TRADE] Instrument config: ${ticker}/${exchange} lot_size=${instrumentConfig.lotSize} strike_interval=${instrumentConfig.strikeInterval}`,
      );
    } else {
      console.log(
        `[TRADE] No instrument config found for ${ticker}/${exchange} — using defaults`,
      );
    }
  }

  let openTrades = tradingCache.getOpenTradesByPlanId(plan.id);
  if (!openTrades) {
    openTrades = await storage.getOpenTradesByPlan(plan.id);
    tradingCache.setOpenTradesByPlanId(plan.id, openTrades);
  }

  const ctx: TradeContext = {
    ticker,
    exchange,
    price,
    resolvedBlockType,
    lotMultiplier,
    now,
    today,
    data,
    openTrades,
    signalContext,
    startTime,
    legs,
    blockConfig,
    instrumentConfig,
  };

  console.log(
    `[PFL] Plan "${plan.name}" — openTrades=${openTrades.length} awaitingCleanEntry=${plan.awaitingCleanEntry}`,
  );

  if (signalType === "buy") {
    console.log(`[PFL] Plan "${plan.name}" → executeBuySignal`);
    return executeBuySignal(storage, plan, brokerConfig, ctx);
  }

  if (signalType === "sell") {
    const resolvedAction2 = signalContext?.resolvedAction || "EXIT";
    if (
      plan.awaitingCleanEntry &&
      resolvedAction2 === "EXIT" &&
      openTrades.length === 0
    ) {
      console.log(
        `[PFL] ⏸ Plan "${plan.name}" — awaitingCleanEntry=true + EXIT + no open trades → HOLD`,
      );
      logPFL(
        plan,
        broker,
        data,
        "hold",
        "Awaiting clean entry — no position to exit, skipping",
        {
          resolvedAction: resolvedAction2,
          blockType: resolvedBlockType,
          ticker,
          exchange,
          price,
          executionTimeMs: Date.now() - startTime,
        },
      );
      return {
        success: true,
        action: "hold",
        broker,
        planId: plan.id,
        message: "Awaiting clean entry — no position to exit, skipping",
        executionTimeMs: Date.now() - startTime,
      };
    }
    console.log(
      `[PFL] Plan "${plan.name}" → executeSellSignal (resolvedAction=${resolvedAction2})`,
    );
    return executeSellSignal(storage, plan, brokerConfig, ctx);
  }

  console.log(
    `[PFL] ✗ Plan "${plan.name}" — Unknown signal type: ${signalType}`,
  );
  logPFL(plan, broker, data, "error", `Unknown signal type: ${signalType}`, {
    resolvedAction,
    blockType: resolvedBlockType,
    ticker,
    exchange,
    price,
    executionTimeMs: Date.now() - startTime,
  });
  return {
    success: false,
    action: "error",
    broker,
    planId: plan.id,
    message: `Unknown signal type: ${signalType}`,
    executionTimeMs: Date.now() - startTime,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// TRADE CONTEXT & ORDER PARAMETER RESOLUTION
// Builds trading symbol, calculates quantity, maps product code & tx type
// ═══════════════════════════════════════════════════════════════════════════════
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
  legs: PlanTradeLeg[];
  blockConfig: Record<string, any>;
  instrumentConfig?: InstrumentConfig;
}

function resolveOrderParams(
  leg: PlanTradeLeg,
  ctx: TradeContext,
  legIndex: number,
):
  | {
      tradingSymbol: string;
      quantity: number;
      productCode: string;
      transactionType: string;
    }
  | { error: string } {
  const isOption =
    isOptionExchange(ctx.exchange) && (leg.type === "CE" || leg.type === "PE");

  if (isOption && !ctx.instrumentConfig) {
    return {
      error: `Missing instrument_config for ${ctx.ticker}/${ctx.exchange} — cannot trade options without lot_size/strike_interval`,
    };
  }

  const lotSize = ctx.instrumentConfig?.lotSize ?? 1;
  const strikeInterval = ctx.instrumentConfig?.strikeInterval ?? 50;
  const expiryDay = ctx.instrumentConfig?.expiryDay ?? "Thursday";
  const expiryType = ctx.instrumentConfig?.expiryType ?? "weekly";
  if (isOption) {
    const missing: string[] = [];
    if (!ctx.instrumentConfig?.lotSize) missing.push(`lotSize=${lotSize}`);
    if (!ctx.instrumentConfig?.strikeInterval)
      missing.push(`strikeInterval=${strikeInterval}`);
    if (!ctx.instrumentConfig?.expiryDay)
      missing.push(`expiryDay=${expiryDay}`);
    if (!ctx.instrumentConfig?.expiryType)
      missing.push(`expiryType=${expiryType}`);
    if (missing.length > 0) {
      console.warn(
        `[TE] Using DB column defaults for ${ctx.ticker}/${ctx.exchange}: ${missing.join(", ")} — verify instrument_configs table`,
      );
    }
  }

  let tradingSymbol = ctx.ticker;
  if (
    isOption &&
    isStrikeSpec(leg.strike) &&
    (leg.type === "CE" || leg.type === "PE")
  ) {
    if (!ctx.price || ctx.price <= 0) {
      return {
        error: `Cannot calculate ${leg.strike} strike for ${ctx.ticker} — spot price is ${ctx.price || 0}. Webhook must include a valid price field.`,
      };
    }
    tradingSymbol = buildKotakOptionSymbol(
      ctx.ticker,
      ctx.price,
      leg.strike,
      leg.type,
      strikeInterval,
      expiryDay,
      expiryType,
    );
  } else if (leg.type === "FUT") {
    tradingSymbol = `${ctx.ticker}-FUT`;
  }

  const quantity = (leg.lots || 1) * lotSize * ctx.lotMultiplier;
  const dbProductDefault = TL.isReady()
    ? TL.getDefaultByUniversalName("productType", "order_place")
    : null;
  const productCode =
    leg.orderType || ctx.blockConfig.productMode || dbProductDefault || "MIS";
  if (!leg.orderType && !ctx.blockConfig.productMode && !dbProductDefault) {
    console.warn(
      `[TE] productType default not found in DB — using last-resort "MIS". Set default_value on broker_field_mappings for productType.`,
    );
  }
  const transactionType = mapTransactionType(leg.action);

  console.log(
    `[TRADE] Leg[${legIndex}] order params: symbol=${tradingSymbol} qty=${quantity} (${leg.lots}×${lotSize}×${ctx.lotMultiplier}) product=${productCode} tx=${transactionType} [${leg.type} ${leg.strike} ${leg.action}]`,
  );

  return { tradingSymbol, quantity, productCode, transactionType };
}

// ═══════════════════════════════s��═══════════════════════════════════════════════
// BUY EXECUTION
// Checks for duplicate positions, places order on broker, records trade in DB
// ═══════════════════════════════════════════════════════════════════════════════
async function executeBuySignal(
  storage: IStorage,
  plan: StrategyPlan,
  brokerConfig: BrokerConfig,
  ctx: TradeContext,
): Promise<TradeResult> {
  const broker = brokerConfig.brokerName;

  const existingBuy = ctx.openTrades.find((t) => t.action === "BUY");
  if (existingBuy) {
    console.log(
      `[PFL] ⏸ Plan "${plan.name}" BUY — position already open (${existingBuy.tradingSymbol}), holding`,
    );
    logPFL(
      plan,
      broker,
      ctx.data,
      "hold",
      `Buy position already open (${existingBuy.tradingSymbol}) — holding`,
      {
        resolvedAction: "ENTRY",
        blockType: ctx.resolvedBlockType,
        ticker: ctx.ticker,
        exchange: ctx.exchange,
        price: ctx.price,
        executionTimeMs: Date.now() - ctx.startTime,
      },
    );
    return {
      success: true,
      action: "hold",
      broker,
      planId: plan.id,
      message: "Buy position already open — holding",
      executionTimeMs: Date.now() - ctx.startTime,
    };
  }

  const openSell = ctx.openTrades.find((t) => t.action === "SELL");
  if (openSell) {
    console.log(
      `[PFL] Plan "${plan.name}" BUY — closing existing SELL position (${openSell.tradingSymbol})`,
    );
    const closedTrade = await closeTrade(
      storage,
      openSell,
      ctx.price,
      ctx.now,
      brokerConfig,
    );
    deferDailyPnlUpdate(storage, plan.id, ctx.today, closedTrade.pnl || 0);
  }

  if (
    broker === "kotak_neo" &&
    (!brokerConfig.isConnected ||
      !brokerConfig.accessToken ||
      !brokerConfig.sessionId ||
      !brokerConfig.baseUrl)
  ) {
    console.log(
      `[PFL] ✗ Plan "${plan.name}" BUY — Kotak Neo session expired/not connected (connected=${brokerConfig.isConnected} token=${!!brokerConfig.accessToken} session=${!!brokerConfig.sessionId} baseUrl=${!!brokerConfig.baseUrl})`,
    );
    logPFL(
      plan,
      broker,
      ctx.data,
      "error",
      "Kotak Neo session expired or not connected",
      {
        resolvedAction: "ENTRY",
        blockType: ctx.resolvedBlockType,
        ticker: ctx.ticker,
        exchange: ctx.exchange,
        price: ctx.price,
        executionTimeMs: Date.now() - ctx.startTime,
      },
    );
    return {
      success: false,
      action: "error",
      broker,
      planId: plan.id,
      message: "Kotak Neo session expired or not connected",
      executionTimeMs: Date.now() - ctx.startTime,
    };
  }

  const dbOrderType = TL.getDefaultByUniversalName("priceType", "order_place");
  if (!dbOrderType)
    console.warn(
      "[TE] priceType default not found in DB — using last-resort MKT",
    );
  const orderTypeForRecord = dbOrderType || "MKT";

  const trades: any[] = [];
  const orderIds: string[] = [];

  for (let i = 0; i < ctx.legs.length; i++) {
    const leg = ctx.legs[i];
    const resolved = resolveOrderParams(leg, ctx, i);
    if ("error" in resolved) {
      logPFL(plan, broker, ctx.data, "error", resolved.error, {
        resolvedAction: "ENTRY",
        blockType: ctx.resolvedBlockType,
        ticker: ctx.ticker,
        exchange: ctx.exchange,
        price: ctx.price,
        executionTimeMs: Date.now() - ctx.startTime,
      });
      return {
        success: false,
        action: "error",
        broker,
        planId: plan.id,
        message: resolved.error,
        executionTimeMs: Date.now() - ctx.startTime,
      };
    }
    const params = resolved;

    let orderId: string | undefined;
    let productType = "PAPER";

    if (broker === "kotak_neo") {
      const universalPayload: Record<string, any> = {
        tradingSymbol: params.tradingSymbol,
        exchange: EL.mapExchange(ctx.exchange),
        transactionType: params.transactionType,
        quantity: String(params.quantity),
        productType: params.productCode,
      };
      console.log(
        `[PFL] Plan "${plan.name}" BUY L${i} — placing Kotak order: ${JSON.stringify(universalPayload)}`,
      );
      const orderResult = await EL.placeOrder(brokerConfig, universalPayload);

      if (!orderResult.success) {
        console.log(
          `[PFL] ✗ Plan "${plan.name}" BUY L${i} — ORDER FAILED: ${orderResult.error}`,
        );
        logPFL(
          plan,
          broker,
          ctx.data,
          "error",
          `Kotak Neo BUY leg[${i}] order failed: ${orderResult.error}`,
          {
            resolvedAction: "ENTRY",
            blockType: ctx.resolvedBlockType,
            ticker: ctx.ticker,
            exchange: ctx.exchange,
            price: ctx.price,
            executionTimeMs: Date.now() - ctx.startTime,
          },
        );
        return {
          success: false,
          action: "error",
          broker,
          planId: plan.id,
          message: `Kotak Neo leg[${i}] order failed: ${orderResult.error}`,
          executionTimeMs: Date.now() - ctx.startTime,
        };
      }
      orderId = orderResult.data?.orderNo;
      console.log(
        `[PFL] ✓ Plan "${plan.name}" BUY L${i} — ORDER SUCCESS orderNo=${orderId}`,
      );
      productType = params.productCode;
    } else if (broker === "binance") {
      const session = buildBinanceSession(brokerConfig);
      if (!session)
        return {
          success: false,
          action: "error",
          broker,
          planId: plan.id,
          message: "Binance credentials missing",
          executionTimeMs: Date.now() - ctx.startTime,
        };

      const orderResult = await placeBinanceOrder(session, {
        symbol: ctx.ticker.replace("-", "").replace("/", ""),
        side: "BUY",
        type: "MARKET",
        quantity: params.quantity,
      });

      if (!orderResult.success) {
        return {
          success: false,
          action: "error",
          broker,
          planId: plan.id,
          message: `Binance leg[${i}] order failed: ${orderResult.error}`,
          executionTimeMs: Date.now() - ctx.startTime,
        };
      }
      orderId = orderResult.data?.orderNo;
      productType = "SPOT";
    } else {
      orderId = `PT-${Date.now()}-L${i}`;
      productType = "PAPER";
    }

    const trade = await storage.createStrategyTrade({
      planId: plan.id,
      orderId: orderId || `${broker.toUpperCase()}-${Date.now()}-L${i}`,
      tradingSymbol: params.tradingSymbol,
      exchange: ctx.exchange,
      quantity: params.quantity,
      price: ctx.price,
      action: "BUY",
      blockType: ctx.resolvedBlockType,
      legIndex: i,
      orderType: orderTypeForRecord,
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

    trades.push(trade);
    if (orderId) orderIds.push(orderId);
  }

  tradingCache.invalidateOpenTrades(plan.id);

  if (plan.awaitingCleanEntry) {
    await storage.updateStrategyPlan(plan.id, { awaitingCleanEntry: false });
    if (plan.configId) tradingCache.invalidatePlans(plan.configId);
  }

  const legSummary = ctx.legs
    .map((l, i) => `L${i}:${l.type}/${l.strike}/${l.action}`)
    .join(", ");
  const execMs = Date.now() - ctx.startTime;
  console.log(
    `[PFL] ✓ Plan "${plan.name}" BUY COMPLETE — ${ctx.legs.length} leg(s) [${legSummary}] @ ${ctx.price} orders=[${orderIds.join(",")}] ${execMs}ms`,
  );
  logPFL(
    plan,
    broker,
    ctx.data,
    "open",
    `BUY ${ctx.legs.length} leg(s) [${legSummary}] @ ${ctx.price}`,
    {
      resolvedAction: "ENTRY",
      blockType: ctx.resolvedBlockType,
      ticker: ctx.ticker,
      exchange: ctx.exchange,
      price: ctx.price,
      orderId: orderIds.join(","),
      executionTimeMs: execMs,
    },
  );

  return {
    success: true,
    action: "open",
    broker,
    planId: plan.id,
    trade: trades[0],
    orderId: orderIds[0],
    message: `${broker.toUpperCase()} BUY ${ctx.legs.length} leg(s) [${legSummary}] @ ${ctx.price} [${ctx.resolvedBlockType}]`,
    executionTimeMs: execMs,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// SELL EXECUTION
// Closes existing positions, places sell order on broker, records trade in DB
// ═══════════════════════════════════════════════════════════════════════════════
async function executeSellSignal(
  storage: IStorage,
  plan: StrategyPlan,
  brokerConfig: BrokerConfig,
  ctx: TradeContext,
): Promise<TradeResult> {
  const broker = brokerConfig.brokerName;
  let closePnl = 0;

  const existingBuyToClose = ctx.openTrades.find((t) => t.action === "BUY");
  if (existingBuyToClose) {
    console.log(
      `[PFL] Plan "${plan.name}" SELL — closing existing BUY position (${existingBuyToClose.tradingSymbol})`,
    );
    const closedTrade = await closeTrade(
      storage,
      existingBuyToClose,
      ctx.price,
      ctx.now,
      brokerConfig,
    );
    closePnl = closedTrade.pnl || 0;
    deferDailyPnlUpdate(storage, plan.id, ctx.today, closePnl);
  }

  const existingSell = ctx.openTrades.find((t) => t.action === "SELL");
  if (existingSell) {
    console.log(
      `[PFL] ⏸ Plan "${plan.name}" SELL — position already open (${existingSell.tradingSymbol}), holding`,
    );
    logPFL(
      plan,
      broker,
      ctx.data,
      "hold",
      `Sell position already open (${existingSell.tradingSymbol}) — holding`,
      {
        resolvedAction: "EXIT",
        blockType: ctx.resolvedBlockType,
        ticker: ctx.ticker,
        exchange: ctx.exchange,
        price: ctx.price,
        executionTimeMs: Date.now() - ctx.startTime,
      },
    );
    return {
      success: true,
      action: "hold",
      broker,
      planId: plan.id,
      message: "Sell position already open — holding",
      pnl: closePnl,
      executionTimeMs: Date.now() - ctx.startTime,
    };
  }

  if (
    broker === "kotak_neo" &&
    (!brokerConfig.isConnected ||
      !brokerConfig.accessToken ||
      !brokerConfig.sessionId ||
      !brokerConfig.baseUrl)
  ) {
    console.log(
      `[PFL] ✗ Plan "${plan.name}" SELL — Kotak Neo session expired/not connected (connected=${brokerConfig.isConnected} token=${!!brokerConfig.accessToken} session=${!!brokerConfig.sessionId} baseUrl=${!!brokerConfig.baseUrl})`,
    );
    logPFL(
      plan,
      broker,
      ctx.data,
      "error",
      "Kotak Neo session expired or not connected",
      {
        resolvedAction: "EXIT",
        blockType: ctx.resolvedBlockType,
        ticker: ctx.ticker,
        exchange: ctx.exchange,
        price: ctx.price,
        executionTimeMs: Date.now() - ctx.startTime,
      },
    );
    return {
      success: false,
      action: "error",
      broker,
      planId: plan.id,
      message: "Kotak Neo session expired or not connected",
      executionTimeMs: Date.now() - ctx.startTime,
    };
  }

  const dbOrderType = TL.getDefaultByUniversalName("priceType", "order_place");
  if (!dbOrderType)
    console.warn(
      "[TE] priceType default not found in DB — using last-resort MKT",
    );
  const orderTypeForRecord = dbOrderType || "MKT";

  const trades: any[] = [];
  const orderIds: string[] = [];

  for (let i = 0; i < ctx.legs.length; i++) {
    const leg = ctx.legs[i];
    const resolved = resolveOrderParams(leg, ctx, i);
    if ("error" in resolved) {
      logPFL(plan, broker, ctx.data, "error", resolved.error, {
        resolvedAction: "EXIT",
        blockType: ctx.resolvedBlockType,
        ticker: ctx.ticker,
        exchange: ctx.exchange,
        price: ctx.price,
        executionTimeMs: Date.now() - ctx.startTime,
      });
      return {
        success: false,
        action: "error",
        broker,
        planId: plan.id,
        message: resolved.error,
        executionTimeMs: Date.now() - ctx.startTime,
      };
    }
    const params = resolved;

    let orderId: string | undefined;
    let productType = "PAPER";

    if (broker === "kotak_neo") {
      const universalPayload: Record<string, any> = {
        tradingSymbol: params.tradingSymbol,
        exchange: EL.mapExchange(ctx.exchange),
        transactionType: params.transactionType,
        quantity: String(params.quantity),
        productType: params.productCode,
      };
      console.log(
        `[PFL] Plan "${plan.name}" SELL L${i} — placing Kotak order: ${JSON.stringify(universalPayload)}`,
      );
      const orderResult = await EL.placeOrder(brokerConfig, universalPayload);

      if (!orderResult.success) {
        console.log(
          `[PFL] ✗ Plan "${plan.name}" SELL L${i} — ORDER FAILED: ${orderResult.error}`,
        );
        logPFL(
          plan,
          broker,
          ctx.data,
          "error",
          `Kotak Neo SELL leg[${i}] order failed: ${orderResult.error}`,
          {
            resolvedAction: "EXIT",
            blockType: ctx.resolvedBlockType,
            ticker: ctx.ticker,
            exchange: ctx.exchange,
            price: ctx.price,
            executionTimeMs: Date.now() - ctx.startTime,
          },
        );
        return {
          success: false,
          action: "error",
          broker,
          planId: plan.id,
          message: `Kotak Neo leg[${i}] order failed: ${orderResult.error}`,
          executionTimeMs: Date.now() - ctx.startTime,
        };
      }
      orderId = orderResult.data?.orderNo;
      console.log(
        `[PFL] ✓ Plan "${plan.name}" SELL L${i} — ORDER SUCCESS orderNo=${orderId}`,
      );
      productType = params.productCode;
    } else if (broker === "binance") {
      const session = buildBinanceSession(brokerConfig);
      if (!session)
        return {
          success: false,
          action: "error",
          broker,
          planId: plan.id,
          message: "Binance credentials missing",
          executionTimeMs: Date.now() - ctx.startTime,
        };

      const orderResult = await placeBinanceOrder(session, {
        symbol: ctx.ticker.replace("-", "").replace("/", ""),
        side: "SELL",
        type: "MARKET",
        quantity: params.quantity,
      });

      if (!orderResult.success) {
        return {
          success: false,
          action: "error",
          broker,
          planId: plan.id,
          message: `Binance leg[${i}] order failed: ${orderResult.error}`,
          executionTimeMs: Date.now() - ctx.startTime,
        };
      }
      orderId = orderResult.data?.orderNo;
      productType = "SPOT";
    } else {
      orderId = `PT-${Date.now()}-L${i}`;
      productType = "PAPER";
    }

    const trade = await storage.createStrategyTrade({
      planId: plan.id,
      orderId: orderId || `${broker.toUpperCase()}-${Date.now()}-L${i}`,
      tradingSymbol: params.tradingSymbol,
      exchange: ctx.exchange,
      quantity: params.quantity,
      price: ctx.price,
      action: "SELL",
      blockType: ctx.resolvedBlockType,
      legIndex: i,
      orderType: orderTypeForRecord,
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

    trades.push(trade);
    if (orderId) orderIds.push(orderId);
  }

  tradingCache.invalidateOpenTrades(plan.id);

  if (plan.awaitingCleanEntry) {
    await storage.updateStrategyPlan(plan.id, { awaitingCleanEntry: false });
    if (plan.configId) tradingCache.invalidatePlans(plan.configId);
  }

  const legSummary = ctx.legs
    .map((l, i) => `L${i}:${l.type}/${l.strike}/${l.action}`)
    .join(", ");
  const execMs = Date.now() - ctx.startTime;
  console.log(
    `[PFL] ✓ Plan "${plan.name}" SELL COMPLETE — ${ctx.legs.length} leg(s) [${legSummary}] @ ${ctx.price} pnl=${closePnl} orders=[${orderIds.join(",")}] ${execMs}ms`,
  );
  logPFL(
    plan,
    broker,
    ctx.data,
    "close",
    `SELL ${ctx.legs.length} leg(s) [${legSummary}] @ ${ctx.price} pnl=${closePnl}`,
    {
      resolvedAction: "EXIT",
      blockType: ctx.resolvedBlockType,
      ticker: ctx.ticker,
      exchange: ctx.exchange,
      price: ctx.price,
      orderId: orderIds.join(","),
      executionTimeMs: execMs,
    },
  );

  return {
    success: true,
    action: "open",
    broker,
    planId: plan.id,
    trade: trades[0],
    orderId: orderIds[0],
    pnl: closePnl,
    message: `${broker.toUpperCase()} SELL ${ctx.legs.length} leg(s) [${legSummary}] @ ${ctx.price} [${ctx.resolvedBlockType}]`,
    executionTimeMs: execMs,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// POSITION CLOSE
// Places counter-order on broker to square off, updates DB record, handles P&L
// ═══════════════════════════════════════════════════════════════════════════════
async function closeTrade(
  storage: IStorage,
  trade: StrategyTrade,
  exitPrice: number,
  now: string,
  brokerConfig?: BrokerConfig,
): Promise<StrategyTrade> {
  const entryPrice = trade.price || 0;
  const qty = trade.quantity || 1;
  const pnl =
    trade.action === "BUY"
      ? (exitPrice - entryPrice) * qty
      : (entryPrice - exitPrice) * qty;

  const exitAction = trade.action === "BUY" ? "SELL" : "BUY";
  const exitTxType = mapTransactionType(exitAction);

  if (
    brokerConfig &&
    brokerConfig.brokerName === "kotak_neo" &&
    brokerConfig.isConnected &&
    brokerConfig.accessToken &&
    brokerConfig.sessionId &&
    brokerConfig.baseUrl
  ) {
    if (!trade.tradingSymbol || !trade.exchange || !trade.productType) {
      console.error(
        `[TRADE] Cannot close on broker — missing trade fields: symbol=${trade.tradingSymbol} exchange=${trade.exchange} product=${trade.productType}`,
      );
      const failedUpdate = await storage.updateStrategyTrade(trade.id, {
        status: "close_failed",
        ltp: exitPrice,
        updatedAt: now,
      });
      tradingCache.invalidateOpenTrades(trade.planId);
      return failedUpdate || trade;
    }

    const universalPayload: Record<string, any> = {
      tradingSymbol: trade.tradingSymbol,
      exchange: EL.mapExchange(trade.exchange),
      transactionType: exitTxType,
      quantity: String(qty),
      productType: trade.productType,
    };

    console.log(
      `[TE] Close order payload (dynamic only): ${JSON.stringify(universalPayload)}`,
    );
    const orderResult = await EL.placeOrder(brokerConfig, universalPayload);

    if (!orderResult.success) {
      console.error(
        `[TRADE] Close order FAILED for ${trade.tradingSymbol}: ${orderResult.error}`,
      );
      const failedUpdate = await storage.updateStrategyTrade(trade.id, {
        status: "close_failed",
        ltp: exitPrice,
        updatedAt: now,
      });
      tradingCache.invalidateOpenTrades(trade.planId);
      return failedUpdate || trade;
    }

    console.log(
      `[TRADE] Close order placed: ${trade.tradingSymbol} orderNo=${orderResult.data?.orderNo}`,
    );
  } else if (brokerConfig && brokerConfig.brokerName === "kotak_neo") {
    console.warn(
      `[TRADE] Cannot close position on broker — session expired. Closing DB record only for ${trade.tradingSymbol}`,
    );
  }

  const updated = await storage.updateStrategyTrade(trade.id, {
    status: "closed",
    pnl: Math.round(pnl * 100) / 100,
    ltp: exitPrice,
    exitPrice,
    exitAction,
    exitedAt: now,
    updatedAt: now,
  });

  tradingCache.invalidateOpenTrades(trade.planId);

  const remainingOpen = await storage.getOpenTradesByPlan(trade.planId);
  if (remainingOpen.length === 0) {
    await storage.updateStrategyPlan(trade.planId, {
      awaitingCleanEntry: true,
    });
    const plan = await storage.getStrategyPlan(trade.planId);
    if (plan?.configId) tradingCache.invalidatePlans(plan.configId);
  }

  return updated || trade;
}

// ═══════════════════════════════════════════════════════════════════════════════
// P&L TRACKING
// Deferred daily P&L calculation and update (runs in background)
// ═══════════════════════════════════════════════════════════════════════════════
function deferDailyPnlUpdate(
  storage: IStorage,
  planId: string,
  date: string,
  tradePnl: number,
): void {
  setImmediate(async () => {
    try {
      const existingEntries = await storage.getStrategyDailyPnl(planId);
      const todayEntry = existingEntries.find((e) => e.date === date);
      const allTrades = await storage.getStrategyTradesByPlan(planId);
      const openCount = allTrades.filter(
        (t) => t.status === "open" || t.status === "pending",
      ).length;
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
    } catch (err) {
      console.error("Deferred daily P&L update error:", err);
    }
  });
}
