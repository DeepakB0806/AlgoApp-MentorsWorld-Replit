// ═══════════════════════════════════════════════════════════════════════════════
// IMPORTS
// ═══════════════════════════════════════════════════════════════════════════════
import type { IStorage } from "./storage";
import type {
  StrategyPlan,
  StrategyTrade,
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
  isOptionExchange,
  isStrikeSpec,
  parseStrikeSpec,
  getATMStrike,
  getOTMStrike,
  getTargetExpiry,
} from "./option-symbol-builder";
import { liveContractCache } from "./smc-kotak-neo-v3";

// ═══════════════════════════════════════════════════════════════════════════════
// FILL PRICE LOOKUP
// After a Kotak order is placed, fetch actual execution price from order history
// ═══════════════════════════════════════════════════════════════════════════════
async function getFillPrice(brokerConfig: BrokerConfig, orderId: string, fallback: number): Promise<{ fillPrice: number; status: string; reason: string; filledQty: number }> {
  try {
    const histResult = await EL.getOrderHistory(brokerConfig, orderId);
    if (histResult.success && Array.isArray(histResult.data) && histResult.data.length > 0) {
      const latest = histResult.data[histResult.data.length - 1] as any;
      const fill = Number(
        latest?.avgPrc || latest?.avgPrice || latest?.avg_prc ||
        latest?.flprc  || latest?.fillPrice || latest?.fill_price ||
        latest?.prc    || latest?.pr || 0
      );
      const status = latest?.ordSt || latest?.stText || "UNKNOWN";
      const reason = latest?.rejReason || latest?.rjBy || "";
      const filledQty = Number(latest?.filledShares || latest?.fldQty || latest?.fil_qty || 0);
      if (fill > 0) {
        console.log(`[TE] Fill price from order history (${orderId.slice(0,8)}): ${fill} (fallback was ${fallback})`);
        return { fillPrice: fill, status, reason, filledQty };
      }
      return { fillPrice: fallback, status, reason, filledQty };
    }
  } catch (err) {
    console.warn(`[TE] Could not fetch fill price for order ${orderId.slice(0,8)}: ${err}`);
  }
  return { fillPrice: fallback, status: "UNKNOWN", reason: "", filledQty: 0 };
}

// ═══════════════════════════════════════════════════════════════════════════════
// TRANSACTION TYPE MAPPING
// Maps universal action names (BUY/SELL) to broker-specific codes via TL
// ═══════════════════════════════════════════════════════════════════════════════
function mapTransactionType(action: string): string {
  if (TL.isReady()) {
    const mapped = TL.mapValueFromAllowed("transactionType", "order_place", action);
    if (mapped) return mapped;
    console.error(`[TE] Transaction type mapping not found in DB for action="${action}" — check broker_field_mappings.allowed_values for transactionType`);
  } else {
    console.warn(`[TE] TL not ready — cannot map transaction type for action="${action}"`);
  }
  return action;
}

function mapPriceType(pt: string | null | undefined): string {
  if (pt === "LMT") return "L";
  return pt || "MKT";
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
// ═══════════════════════════════════════════════════════════════════════════════
export function resolveSignalFromActionMapper(
  signalData: Record<string, any>,
  actionMapperJson: string | null | undefined,
): ResolvedSignal {
  const results = resolveAllSignalsFromActionMapper(signalData, actionMapperJson);
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
      if (fieldValue !== undefined && fieldValue !== null && String(fieldValue) === entry.signalValue) {
        const actions: ResolvedSignal[] = [];

        if (entry.uptrend === "EXIT") actions.push({ signalType: "sell", blockType: "uptrendLegs", resolvedAction: "EXIT" });
        if (entry.downtrend === "EXIT") actions.push({ signalType: "sell", blockType: "downtrendLegs", resolvedAction: "EXIT" });
        if (entry.neutral === "EXIT") actions.push({ signalType: "sell", blockType: "neutralLegs", resolvedAction: "EXIT" });

        if (entry.neutral === "ENTRY") actions.push({ signalType: "buy", blockType: "neutralLegs", resolvedAction: "ENTRY" });
        if (entry.uptrend === "ENTRY") actions.push({ signalType: "buy", blockType: "uptrendLegs", resolvedAction: "ENTRY" });
        if (entry.downtrend === "ENTRY") actions.push({ signalType: "buy", blockType: "downtrendLegs", resolvedAction: "ENTRY" });

        if (actions.length > 0) {
          console.log(`[SIGNAL] Resolved ${actions.length} action(s) for signal "${fieldValue}": ${actions.map((a) => `${a.resolvedAction}@${a.blockType}`).join(", ")}`);
          return actions;
        }

        if (entry.uptrend === "HOLD" || entry.downtrend === "HOLD" || entry.neutral === "HOLD") {
          return [{ signalType: "hold", blockType: "neutralLegs", resolvedAction: "HOLD" }];
        }
      }
    }
  }

  const fallbackType = signalData.signalType || (signalData.actionBinary === 1 ? "buy" : signalData.actionBinary === 0 ? "sell" : "hold");
  const fallbackAction = fallbackType === "buy" ? "ENTRY" : fallbackType === "sell" ? "EXIT" : "HOLD";
  return [
    {
      signalType: fallbackType,
      blockType: fallbackType === "buy" ? "uptrendLegs" : fallbackType === "sell" ? "downtrendLegs" : "neutralLegs",
      resolvedAction: fallbackAction as "ENTRY" | "EXIT" | "HOLD",
    },
  ];
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN ENTRY POINT
// ═══════════════════════════════════════════════════════════════════════════════
export async function processTradeSignal(
  storage: IStorage,
  webhookData: WebhookData,
  strategyConfigId: string,
  signalContext?: SignalContext,
): Promise<TradeResult[]> {
  console.log(`[PFL] ▶ processTradeSignal: signal=${webhookData.signalType} alert=${webhookData.alert} config=${strategyConfigId.slice(0, 8)} resolvedAction=${signalContext?.resolvedAction || "N/A"} blockType=${signalContext?.blockType || "N/A"}`);
  const results: TradeResult[] = [];

  let plans = tradingCache.getActivePlansByConfigId(strategyConfigId);
  if (!plans) {
    const allPlans = await storage.getStrategyPlansByConfig(strategyConfigId);
    plans = allPlans.filter((p) => p.brokerConfigId && (p.deploymentStatus === "active" || p.deploymentStatus === "deployed"));
    tradingCache.setActivePlansByConfigId(strategyConfigId, plans);
  }

  if (plans.length === 0) {
    console.warn(`[PFL] ⚠ No active/deployed plans found for config ${strategyConfigId.slice(0, 8)} — signal dropped. Check if plan is still in 'draft' or 'closed' state.`);
    addProcessFlowLog({
      planId: "", planName: "UNKNOWN", signalType: webhookData.signalType || "unknown",
      alert: webhookData.alert || "", resolvedAction: "N/A", blockType: "",
      actionTaken: "dropped", message: `No active/deployed plans for config ${strategyConfigId.slice(0, 8)}. Signal dropped.`,
      broker: "none",
    });
    return [{ success: false, action: "hold", broker: "none", planId: "", message: "No active plans found for this strategy" }];
  }
  console.log(`[PFL] Found ${plans.length} active plan(s): ${plans.map((p) => `${p.name}[${p.id.slice(0, 8)}]`).join(", ")}`);

  const brokerConfigIds = Array.from(new Set(plans.map((p) => p.brokerConfigId!)));
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

// ═══════════════════════════════════════════════════════════════════════════════
// PLAN HELPERS
// ═══════════════════════════════════════════════════════════════════════════════
function parseTradeParams(plan: StrategyPlan): Record<string, any> | null {
  if (!plan.tradeParams) return null;
  try { return typeof plan.tradeParams === "string" ? JSON.parse(plan.tradeParams) : plan.tradeParams; } 
  catch { return null; }
}

function selectLegs(tradeParams: Record<string, any> | null, blockType: string): PlanTradeLeg[] {
  if (!tradeParams) return [];
  const legs = tradeParams[blockType];
  if (Array.isArray(legs) && legs.length > 0) return legs;
  if (Array.isArray(tradeParams.legs) && tradeParams.legs.length > 0) return tradeParams.legs;
  return [];
}

function getBlockConfig(tradeParams: Record<string, any> | null, blockType: string): Record<string, any> {
  if (!tradeParams) return {};
  const configKey = blockType.replace("Legs", "Config");
  return tradeParams[configKey] || {};
}

function logPFL(plan: StrategyPlan, broker: string, data: WebhookData, actionTaken: string, message: string, extra?: Partial<{ resolvedAction: string; blockType: string; ticker: string; exchange: string; price: number; orderId: string; executionTimeMs: number }>) {
  addProcessFlowLog({
    planId: plan.id, planName: plan.name, signalType: data.signalType || "unknown", alert: data.alert || "",
    resolvedAction: extra?.resolvedAction || "N/A", blockType: extra?.blockType || "",
    actionTaken, message, broker, ticker: extra?.ticker, exchange: extra?.exchange, price: extra?.price, orderId: extra?.orderId, executionTimeMs: extra?.executionTimeMs,
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// TRADE ROUTING
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
  const ticker = plan.ticker || data.indices || signalContext?.parentTicker || "UNKNOWN";
  const exchange = plan.exchange || data.exchange || signalContext?.parentExchange;
  const resolvedAction = signalContext?.resolvedAction || "N/A";
  console.log(`[PFL] ── Plan "${plan.name}" [${plan.id.slice(0, 8)}] | broker=${broker} signal=${signalType} alert=${data.alert} action=${resolvedAction} ticker=${ticker} exchange=${exchange || "NONE"} price=${price}`);

  if (!exchange) {
    console.log(`[PFL] ✗ Plan "${plan.name}" — NO EXCHANGE configured (plan/webhook/parent all empty)`);
    logPFL(plan, broker, data, "error", "No exchange configured", { resolvedAction, ticker, price, executionTimeMs: Date.now() - startTime });
    return { success: false, action: "error", broker, planId: plan.id, message: "No exchange configured", executionTimeMs: Date.now() - startTime };
  }

  const resolvedBlockType = signalContext?.blockType || (signalType === "buy" ? "uptrendLegs" : signalType === "sell" ? "downtrendLegs" : "neutralLegs");
  const now = new Date().toISOString();
  const today = now.split("T")[0];
  const lotMultiplier = plan.lotMultiplier || 1;

  if (signalType === "hold" || !signalType) {
    return { success: true, action: "hold", broker, planId: plan.id, message: "Hold signal", executionTimeMs: Date.now() - startTime };
  }

  const tradeParams = parseTradeParams(plan);

  // ═══════════════════════════════════════════════════════════════════════════
  // ACTIVE DAY GATE
  // Checks whether today (IST) falls within the plan's configured Start Day →
  // End Day window. If not, the signal is held — not an error. This enforces
  // the weeklyStartDay / weeklyEndDay settings from Time Logic & Expiry.
  // ═══════════════════════════════════════════════════════════════════════════
  const timeLogicGate = tradeParams?.timeLogic as { weeklyStartDay?: string; weeklyEndDay?: string } | undefined;
  if (timeLogicGate?.weeklyStartDay && timeLogicGate?.weeklyEndDay) {
    const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
    const istDate = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
    const istDayName = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][istDate.getDay()];
    const startIdx = WEEKDAYS.indexOf(timeLogicGate.weeklyStartDay);
    const endIdx = WEEKDAYS.indexOf(timeLogicGate.weeklyEndDay);
    const todayIdx = WEEKDAYS.indexOf(istDayName);
    // Wrap-around support: Wed–Tue (startIdx=2 > endIdx=1) means Wed,Thu,Fri,Mon,Tue are active.
    // Non-wrapping: Mon–Thu (startIdx=0 <= endIdx=3) means simple range check.
    const isActiveDay = startIdx <= endIdx
      ? (todayIdx >= startIdx && todayIdx <= endIdx)
      : (todayIdx >= startIdx || todayIdx <= endIdx);
    if (todayIdx < 0 || !isActiveDay) {
      const msg = `Signal held — today is ${istDayName}, outside active window ${timeLogicGate.weeklyStartDay}–${timeLogicGate.weeklyEndDay}`;
      console.log(`[TE] ${msg}`);
      logPFL(plan, broker, data, "held", msg, { resolvedAction, ticker, exchange, price, executionTimeMs: Date.now() - startTime });
      return { success: true, action: "hold", broker, planId: plan.id, message: msg, executionTimeMs: Date.now() - startTime };
    }
  }

  const legs = selectLegs(tradeParams, resolvedBlockType);
  const blockConfig = getBlockConfig(tradeParams, resolvedBlockType);
  const neutralLegsRaw = tradeParams?.neutralLegs;
  const neutralLegs: PlanTradeLeg[] = Array.isArray(neutralLegsRaw) ? neutralLegsRaw : [];

  if (legs.length === 0) {
    const skipMsg = `No legs configured for ${resolvedBlockType} — signal skipped`;
    console.debug(`[TE] Skipping empty ${resolvedBlockType} block (no legs configured)`);
    return { success: true, action: "hold", broker, planId: plan.id, message: skipMsg, executionTimeMs: Date.now() - startTime };
  }

  console.log(`[PFL] Plan "${plan.name}" — ${legs.length} leg(s) found for ${resolvedBlockType}`);

  let instrumentConfig: InstrumentConfig | undefined;
  if (isOptionExchange(exchange)) {
    instrumentConfig = tradingCache.getInstrumentConfig(ticker, exchange);
    if (!instrumentConfig) {
      instrumentConfig = await storage.getInstrumentConfig(ticker, exchange);
      if (instrumentConfig) tradingCache.setInstrumentConfig(ticker, exchange, instrumentConfig);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // EXPIRY DATE RESOLUTION
  // Reads timeLogic from plan's tradeParams to determine the target expiry
  // date for the multi-expiry contract cache lookup.
  // ═══════════════════════════════════════════════════════════════════════════
  let targetExpiryDate: string | undefined;
  if (isOptionExchange(exchange) && instrumentConfig) {
    const timeLogic = tradeParams?.timeLogic as { expiryType?: string; expiryWeekOffset?: number } | undefined;
    const expiryType = timeLogic?.expiryType || "weekly";
    const weekOffset = timeLogic?.expiryWeekOffset || 0;
    const expiryDay = instrumentConfig.expiryDay;
    if (!expiryDay) {
      const msg = `CRITICAL: expiryDay missing in instrument_config for ${ticker}. Cannot calculate target expiry.`;
      console.error(`[TE] ✗ ${msg}`);
      logPFL(plan, broker, data, "error", msg, { resolvedAction, ticker, exchange, price, executionTimeMs: Date.now() - startTime });
      return { success: false, action: "error", broker, planId: plan.id, message: msg, executionTimeMs: Date.now() - startTime };
    }
    const targetDate = getTargetExpiry(expiryDay, expiryType, weekOffset);
    const ey = targetDate.getFullYear();
    const em = String(targetDate.getMonth() + 1).padStart(2, "0");
    const ed = String(targetDate.getDate()).padStart(2, "0");
    targetExpiryDate = `${ey}-${em}-${ed}`;
    console.log(`[TE] Resolved target expiry: ${expiryDay} + ${expiryType} + offset=${weekOffset} → ${targetExpiryDate}`);
  }

  let openTrades = tradingCache.getOpenTradesByPlanId(plan.id);
  if (!openTrades) {
    openTrades = await storage.getOpenTradesByPlan(plan.id);
    tradingCache.setOpenTradesByPlanId(plan.id, openTrades);
  }

  const ctx: TradeContext = { ticker, exchange, price, resolvedBlockType, lotMultiplier, now, today, data, openTrades, signalContext, startTime, legs, neutralLegs, blockConfig, instrumentConfig, targetExpiryDate };

  // ═══════════════════════════════════════════════════════════════════════════
  // POST-EOD ENTRY GATE
  // Blocks new ENTRY signals after the plan's configured exitTime (IST).
  // Applies universally to all strategies. EXIT signals always bypass.
  // ═══════════════════════════════════════════════════════════════════════════
  const resolvedAction2 = signalContext?.resolvedAction || (signalType === "buy" ? "ENTRY" : signalType === "sell" ? "EXIT" : "HOLD");

  if (resolvedAction2 === "ENTRY") {
    const eodTimeLogic = tradeParams?.timeLogic as { exitTime?: string } | undefined;
    const exitTimeStr = eodTimeLogic?.exitTime;

    if (exitTimeStr) {
      const [exitHour, exitMinute] = exitTimeStr.split(":").map(Number);
      const istDate = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
      const currentHour = istDate.getHours();
      const currentMinute = istDate.getMinutes();
      const isPastExitTime = (currentHour > exitHour) || (currentHour === exitHour && currentMinute >= exitMinute);

      const productMode = ctx.blockConfig.productMode as string | undefined;
      let shouldBlock = false;
      if (productMode === "MIS" && isPastExitTime) {
        shouldBlock = true;
      } else if (productMode === "NRML" && isPastExitTime && ctx.targetExpiryDate === ctx.today) {
        shouldBlock = true;
      }
      // No default fallback — unknown productMode does not block

      if (shouldBlock) {
        const curTime = `${String(currentHour).padStart(2, "0")}:${String(currentMinute).padStart(2, "0")}`;
        const msg = `Signal held — entry blocked after EOD exitTime (${exitTimeStr} IST, current ${curTime} IST)`;
        console.log(`[TE] ${msg}`);
        logPFL(plan, broker, data, "held", msg, { resolvedAction: "ENTRY", ticker, exchange, price, executionTimeMs: Date.now() - startTime });
        return { success: true, action: "hold", broker, planId: plan.id, message: msg, executionTimeMs: Date.now() - startTime };
      }
    }
  }

  if (signalType === "buy") {
    return executeBuySignal(storage, plan, brokerConfig, ctx);
  }

  if (signalType === "sell") {
    const resolvedAction2 = signalContext?.resolvedAction || "EXIT";
    if (plan.awaitingCleanEntry && resolvedAction2 === "EXIT" && openTrades.length === 0) {
      return { success: true, action: "hold", broker, planId: plan.id, message: "Awaiting clean entry", executionTimeMs: Date.now() - startTime };
    }
    return executeSellSignal(storage, plan, brokerConfig, ctx);
  }

  return { success: false, action: "error", broker, planId: plan.id, message: "Unknown signal", executionTimeMs: Date.now() - startTime };
}

// ═══════════════════════════════════════════════════════════════════════════════
// TRADE CONTEXT & ORDER PARAMETER RESOLUTION
// ═══════════════════════════════════════════════════════════════════════════════
interface TradeContext {
  ticker: string; exchange: string; price: number; resolvedBlockType: string; lotMultiplier: number; now: string; today: string; data: WebhookData; openTrades: StrategyTrade[]; signalContext?: SignalContext; startTime: number; legs: PlanTradeLeg[]; neutralLegs: PlanTradeLeg[]; blockConfig: Record<string, any>; instrumentConfig?: InstrumentConfig; targetExpiryDate?: string;
}

function getBufferedLimitPrice(currentPrice: number, action: string, bufferPoints: number): string {
  if (!currentPrice || currentPrice <= 0) return "0";
  const rawPrice = action.toUpperCase() === "BUY"
    ? currentPrice + bufferPoints
    : Math.max(0.05, currentPrice - bufferPoints);
  const roundedPrice = Math.round(rawPrice * 20) / 20;
  return roundedPrice.toFixed(2);
}

function resolveOrderParams(
  leg: PlanTradeLeg,
  ctx: TradeContext,
  legIndex: number,
): { tradingSymbol: string; quantity: number; productCode: string; priceMode: string; transactionType: string } | { error: string } {
  const isOption = isOptionExchange(ctx.exchange) && (leg.type === "CE" || leg.type === "PE");

  if (isOption && !ctx.instrumentConfig) {
    return { error: `Missing instrument_config for ${ctx.ticker}/${ctx.exchange}` };
  }

  const lotSize = ctx.instrumentConfig?.lotSize ?? 1;
  const strikeInterval = ctx.instrumentConfig!.strikeInterval ?? 50;

  let tradingSymbol = ctx.ticker;
  if (isOption && isStrikeSpec(leg.strike) && (leg.type === "CE" || leg.type === "PE")) {
    if (!ctx.price || ctx.price <= 0) {
      return { error: `Cannot calculate ${leg.strike} strike for ${ctx.ticker} — spot price is missing.` };
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // EXPIRY-AWARE CONTRACT RESOLUTION
    // Reads the plan's timeLogic to resolve the target expiry, then looks up
    // the contract in the multi-expiry cache keyed by ticker_YYYY-MM-DD_strike_optType.
    // ═══════════════════════════════════════════════════════════════════════════
    const spec = parseStrikeSpec(leg.strike);
    const atm = getATMStrike(ctx.price, strikeInterval);
    const targetStrike = getOTMStrike(atm, spec, strikeInterval, leg.type);

    const fallbackNow = new Date();
    const fallbackDate = `${fallbackNow.getFullYear()}-${String(fallbackNow.getMonth() + 1).padStart(2, "0")}-${String(fallbackNow.getDate()).padStart(2, "0")}`;
    const expiryDateStr = ctx.targetExpiryDate || fallbackDate;

    // IST stale-expiry guard — abort if requested expiry is already in the past
    const nowIST = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
    const todayISTStr = `${nowIST.getUTCFullYear()}-${String(nowIST.getUTCMonth() + 1).padStart(2, "0")}-${String(nowIST.getUTCDate()).padStart(2, "0")}`;
    if (expiryDateStr < todayISTStr) {
      return { error: `ABORT: Resolved expiry ${expiryDateStr} is in the past (today IST is ${todayISTStr}). Scrip master may not have rolled over yet — trigger a manual sync or wait for the scheduled daily sync.` };
    }

    const cacheKey = `${ctx.ticker}_${expiryDateStr}_${targetStrike}_${leg.type}`;

    let resolvedContract = liveContractCache.get(cacheKey);
    let resolvedExpiry = expiryDateStr;

    // ═══════════════════════════════════════════════════════════════════════════
    // FIX 3: HOLIDAY EXPIRY FALLBACK SCANNER
    // When NSE shifts a weekly expiry due to a holiday (e.g. Thursday → Wednesday),
    // the scrip master CSV stores the actual date while getTargetExpiry returns the
    // theoretical calendar date. Scan cache keys within a ±3-day window and use
    // the nearest actual expiry if the exact key misses.
    // Cache key format: ${ticker}_${YYYY-MM-DD}_${strike}_${optType}
    // Cache value type: { brokerSymbol: string, token: string } — NO metadata fields.
    // ═══════════════════════════════════════════════════════════════════════════
    if (!resolvedContract) {
      console.warn(`[TE] Exact match missed for ${cacheKey}. Initiating Holiday Fallback scan...`);
      let minDiff = Infinity;
      const targetTime = new Date(expiryDateStr).getTime();
      const nowTime = new Date().setHours(0, 0, 0, 0);

      for (const [key, contract] of liveContractCache.entries()) {
        const parts = key.split("_");
        if (parts.length !== 4) continue;
        const [keyTicker, keyDate, keyStrike, keyOptType] = parts;
        if (keyTicker !== ctx.ticker) continue;
        if (Number(keyStrike) !== Number(targetStrike)) continue;
        if (keyOptType !== leg.type) continue;
        const contractTime = new Date(keyDate).getTime();
        if (contractTime < nowTime) continue;
        const diff = Math.abs(contractTime - targetTime);
        if (diff < minDiff && diff <= 3 * 24 * 60 * 60 * 1000) {
          minDiff = diff;
          resolvedContract = contract;
          resolvedExpiry = keyDate;
        }
      }

      if (resolvedContract) {
        console.warn(`[TE] Holiday Fallback: ${cacheKey} → using ${ctx.ticker}_${resolvedExpiry}_${targetStrike}_${leg.type} (shifted by ${Math.round(minDiff / 86400000)}d)`);
      } else {
        return { error: `No contract in multi-expiry cache for ${cacheKey}. Holiday Fallback also failed (±3d window). Run Scrip Master Sync or check expiry settings.` };
      }
    }

    tradingSymbol = resolvedContract.brokerSymbol;
    console.log(`[TE] Cache HIT: ${cacheKey} → ${tradingSymbol} (expiry=${resolvedExpiry})`);
  } else if (leg.type === "FUT") {
    tradingSymbol = `${ctx.ticker}-FUT`;
  }

  const quantity = (leg.lots || 1) * lotSize * ctx.lotMultiplier;

  const dbProductDefault = TL.isReady() ? TL.getDefaultByUniversalName("productType", "order_place") : null;
  const productCode = ctx.blockConfig.productMode || dbProductDefault;
  if (!productCode) return { error: "ABORT: Product Type (NRML/MIS) not found in plan config or global DB defaults." };

  const dbPriceDefault = TL.isReady() ? TL.getDefaultByUniversalName("priceType", "order_place") : null;
  const priceMode = ctx.blockConfig.priceMode || dbPriceDefault;
  if (!priceMode) return { error: "ABORT: Price Type (LMT/MKT) not found in plan config or global DB defaults." };

  const transactionType = mapTransactionType(leg.action);

  console.log(`[TRADE] Leg[${legIndex}] order params: symbol=${tradingSymbol} qty=${quantity} product=${productCode} price=${priceMode}`);
  return { tradingSymbol, quantity, productCode, priceMode, transactionType };
}

// ═══════════════════════════════════════════════════════════════════════════════
// SHARED BASKET EXECUTOR (ENTERPRISE STATE MACHINE ROLLBACK)
// Places legs sequentially. On margin shortfall: writes each leg to DB as
// "pending_basket" BEFORE placement so rollback has a real DB ID to update.
// Rollback transitions: pending_basket → rolling_back → rolled_back/rollback_failed
// ═══════════════════════════════════════════════════════════════════════════════
type BasketItem = { leg: PlanTradeLeg; blockType: string; legIndex: number };

async function executeLegBasket(
  storage: IStorage, plan: StrategyPlan, brokerConfig: BrokerConfig, ctx: TradeContext,
  items: BasketItem[],
): Promise<{ trades: any[]; orderIds: string[]; error?: string }> {
  const broker = brokerConfig.brokerName;
  let finalTrades: StrategyTrade[] = [];
  let finalOrderIds: string[] = [];
  let finalError: string | undefined;

  const retrySetting = await storage.getSetting("margin_shortfall_retry_count");
  if (!retrySetting?.value && retrySetting?.value !== "0") {
    const abortMsg = "ABORT: margin_shortfall_retry_count is missing from app_settings.";
    logPFL(plan, broker, ctx.data, "error", abortMsg);
    throw new Error(abortMsg);
  }
  const maxRetries = parseInt(retrySetting.value, 10);

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const landedLegs: StrategyTrade[] = [];
    const attemptOrderIds: string[] = [];
    let attemptFailed = false;

    const effectiveMultiplier = Math.max(1, ctx.lotMultiplier - attempt);

    for (const { leg, blockType, legIndex } of items) {
      const tempCtx = { ...ctx, lotMultiplier: effectiveMultiplier };
      const resolved = resolveOrderParams(leg, tempCtx, legIndex);
      if ("error" in resolved) {
        logPFL(plan, broker, ctx.data, "error", `[TE] ${resolved.error}`);
        finalError = resolved.error;
        attemptFailed = true;
        break;
      }

      let orderId: string | undefined;
      let productType = "PAPER";
      let orderStatus = "COMPLETE";
      let orderReason = "";
      let fillPrice = ctx.price;

      // FIX 2: Track actual filled quantity from broker confirmation
      let actualFilledQty = resolved.quantity;

      if (broker === "kotak_neo") {
        const bufferSetting = await storage.getSetting("limit_order_buffer_points");
        if (!bufferSetting?.value && resolved.priceMode === "LMT") {
          const abortMsg = "ABORT: limit_order_buffer_points is missing from app_settings.";
          logPFL(plan, broker, ctx.data, "error", abortMsg);
          throw new Error(abortMsg);
        }
        const bufferPoints = parseFloat(bufferSetting?.value || "0");
        const entryPrice = ctx.price || 0;
        const finalPrice = resolved.priceMode === "LMT"
          ? getBufferedLimitPrice(entryPrice, leg.action, bufferPoints)
          : "0";
        const orderResult = await EL.placeOrder(brokerConfig, {
          tradingSymbol: resolved.tradingSymbol, exchange: EL.mapExchange(ctx.exchange),
          transactionType: resolved.transactionType, quantity: String(resolved.quantity),
          productType: resolved.productCode,
          priceType: mapPriceType(resolved.priceMode), price: finalPrice,
          validity: "DAY", afterMarket: "NO",
        });

        if (!orderResult.success) {
          orderStatus = "REJECTED";
          orderReason = orderResult.error || "Unknown placeOrder error";
        } else {
          orderId = orderResult.data?.orderNo;
          productType = resolved.productCode;
          if (orderId) {
            const statusObj = await getFillPrice(brokerConfig, orderId, ctx.price);
            fillPrice = statusObj.fillPrice;
            orderStatus = statusObj.status;
            orderReason = statusObj.reason;

            // FIX 2: Persist partial fill data when broker fills less than ordered
            if (statusObj.filledQty > 0 && statusObj.filledQty !== resolved.quantity) {
              actualFilledQty = statusObj.filledQty;
              logPFL(plan, broker, ctx.data, "warn", `[WARN] Partial fill detected for ${resolved.tradingSymbol}: Ordered ${resolved.quantity}, Filled ${actualFilledQty}`);
            }
          }
        }

        if (orderStatus === "REJECTED" || orderStatus === "CANCELLED") {
          logPFL(plan, broker, ctx.data, "error", `[ORDER] ${orderId || "N/A"} → ${orderStatus} | symbol: ${resolved.tradingSymbol} | reason: ${orderReason}`);
        } else {
          logPFL(plan, broker, ctx.data, "info", `[ORDER] ${orderId || "N/A"} → ${orderStatus} | symbol: ${resolved.tradingSymbol} | qty: ${actualFilledQty}`);
        }

        if (items.length > 1) {
          const settingRow = await storage.getSetting("order_execution_delay_ms");
          if (!settingRow?.value && settingRow?.value !== "0") {
            const abortMsg = "ABORT: order_execution_delay_ms is missing from app_settings.";
            logPFL(plan, broker, ctx.data, "error", abortMsg);
            throw new Error(abortMsg);
          }
          const _parsed = parseInt(settingRow.value, 10);
          const delayMs = Math.max(0, _parsed);
          await new Promise(r => setTimeout(r, delayMs));
        }
      } else {
        orderId = `PT-${Date.now()}-L${legIndex}`;
      }

      // Rejection handling with Enterprise State Machine Rollback
      if (orderStatus === "REJECTED" || orderStatus === "CANCELLED") {
        const lowerReason = orderReason.toLowerCase();
        if (lowerReason.includes("margin") || lowerReason.includes("rms") || lowerReason.includes("shortfall")) {
          console.warn(`[TE] Margin shortfall detected. Initiating Enterprise State Machine Rollback for attempt ${attempt + 1}...`);

          // FIX 3b: State machine rollback — each landed leg already has a DB record
          for (const landed of landedLegs) {
            await storage.updateStrategyTrade(landed.id, { status: "rolling_back", updatedAt: ctx.now });

            const reverseAction = landed.action?.toUpperCase() === "BUY" ? "SELL" : "BUY";
            logPFL(plan, broker, ctx.data, "warn", `[ROLLBACK] Reversing ${landed.tradingSymbol} qty=${landed.quantity}`);

            const rbBufferSetting = await storage.getSetting("limit_order_buffer_points");
            if (!rbBufferSetting?.value && rbBufferSetting?.value !== "0") {
              const abortMsg = "ABORT: limit_order_buffer_points is missing from app_settings.";
              logPFL(plan, broker, ctx.data, "error", abortMsg);
              throw new Error(abortMsg);
            }
            const rbBufferPoints = parseFloat(rbBufferSetting.value);
            const rbPriceMode = (ctx.blockConfig.priceMode as string | undefined)
              || (TL.isReady() ? TL.getDefaultByUniversalName("priceType", "order_place") : null);
            if (!rbPriceMode) {
              logPFL(plan, broker, ctx.data, "error", `ABORT: Price Type (LMT/MKT) missing for rollback of ${landed.tradingSymbol}. Marking rollback_failed.`);
              await storage.updateStrategyTrade(landed.id, { status: "rollback_failed", updatedAt: ctx.now });
              startPersistentRollback(storage, plan.id, brokerConfig);
              continue;
            }
            if (!landed.productType) {
              logPFL(plan, broker, ctx.data, "error", `ABORT: productType missing for rollback of ${landed.tradingSymbol}. Marking rollback_failed.`);
              await storage.updateStrategyTrade(landed.id, { status: "rollback_failed", updatedAt: ctx.now });
              startPersistentRollback(storage, plan.id, brokerConfig);
              continue;
            }
            const rbPrice = rbPriceMode === "LMT"
              ? getBufferedLimitPrice(landed.ltp || landed.price || 0, reverseAction, rbBufferPoints)
              : "0";
            const rbResult = await EL.placeOrder(brokerConfig, {
              tradingSymbol: landed.tradingSymbol, exchange: EL.mapExchange(ctx.exchange),
              transactionType: mapTransactionType(reverseAction), quantity: String(landed.quantity),
              productType: landed.productType, priceType: mapPriceType(rbPriceMode), price: rbPrice,
              validity: "DAY", afterMarket: "NO",
            });

            if (rbResult.success) {
              await storage.updateStrategyTrade(landed.id, { status: "rolled_back", exitedAt: ctx.now, updatedAt: ctx.now });
              logPFL(plan, broker, ctx.data, "info", `[ROLLBACK] Successfully reversed ${landed.tradingSymbol}`);
            } else {
              await storage.updateStrategyTrade(landed.id, { status: "rollback_failed", updatedAt: ctx.now });
              logPFL(plan, broker, ctx.data, "error", `[FATAL] ROLLBACK FAILED for ${landed.tradingSymbol}. Initiating persistent background recovery.`);
              startPersistentRollback(storage, plan.id, brokerConfig);
            }
          }

          finalError = `Margin shortfall: ${orderReason}`;
          attemptFailed = true;

          // FIX 1: Circuit breaker AFTER rollback — rollback landed legs first, THEN abort
          if (effectiveMultiplier <= 1) {
            const msg = `Margin shortfall at minimum lot size (1x): ${orderReason}. Cannot reduce further. Aborting.`;
            logPFL(plan, broker, ctx.data, "error", `[ABORT] ${msg}`);
            return { trades: [], orderIds: [], error: msg };
          }

          break;
        } else {
          finalError = `Order rejected: ${orderReason}`;
          return { trades: [], orderIds: [], error: finalError };
        }
      }

      // FIX 3a: Immediate DB write as "pending_basket" — leg gets a real ID before any rollback can occur
      const stagedTrade = {
        planId: plan.id, orderId: orderId || `${broker.toUpperCase()}-${Date.now()}-L${legIndex}`,
        tradingSymbol: resolved.tradingSymbol, exchange: ctx.exchange, quantity: actualFilledQty,
        price: fillPrice, action: (leg.action || "BUY").toUpperCase(), blockType, legIndex,
        orderType: resolved.priceMode, productType, status: "pending_basket", pnl: 0, ltp: fillPrice,
        executedAt: ctx.now, createdAt: ctx.now, updatedAt: ctx.now,
        timeUnix: ctx.data.timeUnix || null, ticker: ctx.data.indices || ctx.ticker,
        indicator: ctx.data.indicator || null, alert: ctx.data.alert || null,
        localTime: ctx.data.localTime || null, mode: ctx.data.mode || null, modeDesc: ctx.data.modeDesc || null,
        webhookDataId: ctx.data.id || undefined,
        rejectedReason: orderReason || null,
      };

      const savedTrade = await storage.createStrategyTrade(stagedTrade as any);
      landedLegs.push(savedTrade);
      if (orderId) attemptOrderIds.push(orderId);
    }

    if (!attemptFailed) {
      // Basket succeeded: promote all "pending_basket" records to "open"
      for (const landed of landedLegs) {
        const updated = await storage.updateStrategyTrade(landed.id, { status: "open", updatedAt: ctx.now });
        finalTrades.push(updated || landed);
      }
      finalOrderIds = attemptOrderIds;
      return { trades: finalTrades, orderIds: finalOrderIds };
    } else if (attempt < maxRetries && finalError?.includes("Margin shortfall")) {
      const retryRow = await storage.getSetting("squareoff_retry_interval_ms");
      if (!retryRow?.value && retryRow?.value !== "0") {
        const abortMsg = "ABORT: squareoff_retry_interval_ms is missing from app_settings.";
        logPFL(plan, broker, ctx.data, "error", abortMsg);
        throw new Error(abortMsg);
      }
      const retryDelay = Math.max(0, parseInt(retryRow.value, 10));
      console.log(`[TE] Retrying basket at lotMultiplier=${Math.max(1, ctx.lotMultiplier - attempt - 1)} in ${retryDelay}ms...`);
      await new Promise(r => setTimeout(r, retryDelay));
    } else {
      break;
    }
  }

  return { trades: [], orderIds: [], error: finalError };
}

// Assembles the entry basket for the resolved block only. Sorted BUY-before-SELL universally.
// Neutral legs are NOT auto-entered here — they enter only when the configurator
// explicitly dispatches ENTRY@neutralLegs as its own processTradeSignal call.
function buildEntryBasket(ctx: TradeContext, currentOpen: StrategyTrade[]): BasketItem[] {
  const items: BasketItem[] = [];
  ctx.legs.forEach((leg, i) => items.push({ leg, blockType: ctx.resolvedBlockType, legIndex: i }));
  items.sort((a, b) => {
    const aB = (a.leg.action || "BUY").toUpperCase() === "BUY";
    const bB = (b.leg.action || "BUY").toUpperCase() === "BUY";
    return aB === bB ? 0 : aB ? -1 : 1;
  });
  return items;
}

// ═══════════════════════════════════════════════════════════════════════════════
// BUY EXECUTION (HANDLES "ENTRY" SIGNALS)
// ═══════════════════════════════════════════════════════════════════════════════
async function executeBuySignal(
  storage: IStorage, plan: StrategyPlan, brokerConfig: BrokerConfig, ctx: TradeContext,
): Promise<TradeResult> {
  const broker = brokerConfig.brokerName;

  // 1. Prevent duplicate entries for THIS exact directional block
  const existingOpen = ctx.openTrades.find((t) => t.blockType === ctx.resolvedBlockType);
  if (existingOpen) {
    return { success: true, action: "hold", broker, planId: plan.id, message: `${ctx.resolvedBlockType} position already open`, executionTimeMs: Date.now() - ctx.startTime };
  }

  // 2. REVERSALS: Close opposite directional block ONLY (Preserve neutralLegs)
  let targetOppositeBlock: string | null = null;
  if (ctx.resolvedBlockType === "uptrendLegs") targetOppositeBlock = "downtrendLegs";
  else if (ctx.resolvedBlockType === "downtrendLegs") targetOppositeBlock = "uptrendLegs";

  const openOpposites = targetOppositeBlock
    ? ctx.openTrades.filter(t => t.blockType === targetOppositeBlock)
    : [];

  if (openOpposites.length > 0) {
    openOpposites.sort((a, b) => {
      const aFirst = a.action === "SELL"; const bFirst = b.action === "SELL";
      return aFirst === bFirst ? 0 : aFirst ? -1 : 1;
    });
    let closePnl = 0;
    const delaySetting = await storage.getSetting("order_execution_delay_ms");
    if (!delaySetting?.value && delaySetting?.value !== "0") {
      const abortMsg = "ABORT: order_execution_delay_ms is missing from app_settings.";
      logPFL(plan, broker, ctx.data, "error", abortMsg);
      throw new Error(abortMsg);
    }
    const _parsedDelay = parseInt(delaySetting.value, 10);
    const delayMs = Math.max(0, _parsedDelay);

    for (let ci = 0; ci < openOpposites.length; ci++) {
      const closed = await closeTrade(storage, openOpposites[ci], ctx.price, ctx.now, brokerConfig);
      closePnl += closed.pnl || 0;
      if (ci < openOpposites.length - 1) await new Promise(r => setTimeout(r, delayMs));
    }
    deferDailyPnlUpdate(storage, plan.id, ctx.today, closePnl);
    if (ctx.signalContext?.resolvedAction === "EXIT") {
      return { success: true, action: "close", broker, planId: plan.id,
        message: "Successfully closed all positions (Pure EXIT).", executionTimeMs: Date.now() - ctx.startTime };
    }
  } else if (ctx.signalContext?.resolvedAction === "EXIT") {
    return { success: true, action: "hold", broker, planId: plan.id, pnl: 0,
      message: "Nothing to close (Pure EXIT on empty positions).",
      executionTimeMs: Date.now() - ctx.startTime };
  }

  if (broker === "kotak_neo" && (!brokerConfig.isConnected || !brokerConfig.accessToken || !brokerConfig.sessionId || !brokerConfig.baseUrl)) {
    return { success: false, action: "error", broker, planId: plan.id, message: "Kotak Neo session expired", executionTimeMs: Date.now() - ctx.startTime };
  }

  const remainingOpen = ctx.openTrades.filter(t => !openOpposites.some(o => o.id === t.id));
  const basket = buildEntryBasket(ctx, remainingOpen);
  const result = await executeLegBasket(storage, plan, brokerConfig, ctx, basket);
  if (result.error) {
    return { success: false, action: "error", broker, planId: plan.id, message: result.error, executionTimeMs: Date.now() - ctx.startTime };
  }

  tradingCache.invalidateOpenTrades(plan.id);

  if (plan.awaitingCleanEntry) {
    await storage.updateStrategyPlan(plan.id, { awaitingCleanEntry: false });
    if (plan.configId) tradingCache.invalidatePlans(plan.configId);
  }

  return { success: true, action: "open", broker, planId: plan.id, trade: result.trades[0], orderId: result.orderIds[0], message: `ENTRY success`, executionTimeMs: Date.now() - ctx.startTime };
}

// ═══════════════════════════════════════════════════════════════════════════════
// SELL EXECUTION (HANDLES "EXIT" SIGNALS)
// ═══════════════════════════════════════════════════════════════════════════════
async function executeSellSignal(
  storage: IStorage, plan: StrategyPlan, brokerConfig: BrokerConfig, ctx: TradeContext,
): Promise<TradeResult> {
  const broker = brokerConfig.brokerName;
  let closePnl = 0;

  // EXIT: Close directional block ONLY (Preserve neutralLegs)
  const allToClose = ctx.openTrades.filter(t => t.blockType === ctx.resolvedBlockType);
  if (allToClose.length > 0) {
    // Sort: BUY-to-cover SELL positions first (margin safety)
    allToClose.sort((a, b) => {
      const aFirst = a.action === "SELL"; const bFirst = b.action === "SELL";
      return aFirst === bFirst ? 0 : aFirst ? -1 : 1;
    });
    let anyFailed = false;
    const delaySetting = await storage.getSetting("order_execution_delay_ms");
    if (!delaySetting?.value && delaySetting?.value !== "0") {
      const abortMsg = "ABORT: order_execution_delay_ms is missing from app_settings.";
      logPFL(plan, broker, ctx.data, "error", abortMsg);
      throw new Error(abortMsg);
    }
    const _parsedDelay = parseInt(delaySetting.value, 10);
    const delayMs = Math.max(0, _parsedDelay);

    for (let ci = 0; ci < allToClose.length; ci++) {
      const closed = await closeTrade(storage, allToClose[ci], ctx.price, ctx.now, brokerConfig);
      closePnl += closed.pnl || 0;
      if (closed.status === "close_failed") anyFailed = true;
      if (ci < allToClose.length - 1) await new Promise(r => setTimeout(r, delayMs));
    }
    deferDailyPnlUpdate(storage, plan.id, ctx.today, closePnl);
    if (anyFailed) {
      console.warn(`[TE] Plan "${plan.name}" — leg close_failed on ${ctx.resolvedBlockType}, starting persistent exit retry`);
      startPersistentExit(storage, plan.id, ctx.resolvedBlockType, brokerConfig);
    }
    if (ctx.signalContext?.resolvedAction === "EXIT") {
      return { success: true, action: "close", broker, planId: plan.id, pnl: closePnl,
        message: anyFailed ? "Leg close failed — persistent retry started." : "Successfully closed all positions (Pure EXIT).",
        executionTimeMs: Date.now() - ctx.startTime };
    }
  } else if (ctx.signalContext?.resolvedAction === "EXIT") {
    return { success: true, action: "hold", broker, planId: plan.id, pnl: 0,
      message: "Nothing to close (Pure EXIT on empty positions).",
      executionTimeMs: Date.now() - ctx.startTime };
  }

  // OPPOSITE CHECK: Prevent duplicate entries against the exact opposite directional block
  let targetOppositeBlock: string | null = null;
  if (ctx.resolvedBlockType === "uptrendLegs") targetOppositeBlock = "downtrendLegs";
  else if (ctx.resolvedBlockType === "downtrendLegs") targetOppositeBlock = "uptrendLegs";

  const existingOpenOther = targetOppositeBlock ? ctx.openTrades.find(t => t.blockType === targetOppositeBlock) : undefined;
  if (existingOpenOther) {
    return { success: true, action: "hold", broker, planId: plan.id, message: "Opposite position already open", pnl: closePnl, executionTimeMs: Date.now() - ctx.startTime };
  }

  if (broker === "kotak_neo" && (!brokerConfig.isConnected || !brokerConfig.accessToken || !brokerConfig.sessionId || !brokerConfig.baseUrl)) {
    return { success: false, action: "error", broker, planId: plan.id, message: "Kotak Neo session expired", executionTimeMs: Date.now() - ctx.startTime };
  }

  const remainingOpen = ctx.openTrades.filter(t => !allToClose.some(o => o.id === t.id));
  const basket = buildEntryBasket(ctx, remainingOpen);
  const result = await executeLegBasket(storage, plan, brokerConfig, ctx, basket);
  if (result.error) {
    return { success: false, action: "error", broker, planId: plan.id, message: result.error, pnl: closePnl, executionTimeMs: Date.now() - ctx.startTime };
  }

  tradingCache.invalidateOpenTrades(plan.id);

  if (plan.awaitingCleanEntry) {
    await storage.updateStrategyPlan(plan.id, { awaitingCleanEntry: false });
    if (plan.configId) tradingCache.invalidatePlans(plan.configId);
  }

  return { success: true, action: "open", broker, planId: plan.id, trade: result.trades[0], orderId: result.orderIds[0], pnl: closePnl, message: `ENTRY success`, executionTimeMs: Date.now() - ctx.startTime };
}

// ═══════════════════════════════════════════════════════════════════════════════
// TRADE CLOSING & PNL
// ═══════════════════════════════════════════════════════════════════════════════
async function closeTrade(
  storage: IStorage, trade: StrategyTrade, currentPrice: number, now: string, brokerConfig: BrokerConfig,
): Promise<StrategyTrade> {
  const broker = brokerConfig.brokerName;
  let exitPrice = currentPrice;
  const exitAction = trade.action === "BUY" ? "SELL" : "BUY";
  const transactionType = mapTransactionType(exitAction);
  console.log(`[TRADE] Closing leg: symbol=${trade.tradingSymbol} action=${exitAction} transactionType=${transactionType}`);

  if (broker === "kotak_neo" && brokerConfig.isConnected && brokerConfig.accessToken && brokerConfig.sessionId && brokerConfig.baseUrl) {
    if (!trade.tradingSymbol || !trade.exchange || !trade.productType) {
      const failedUpdate = await storage.updateStrategyTrade(trade.id, { status: "close_failed", ltp: exitPrice, updatedAt: now });
      tradingCache.invalidateOpenTrades(trade.planId);
      return failedUpdate || trade;
    }

    const ctPriceMode = TL.isReady()
      ? TL.getDefaultByUniversalName("priceType", "order_place")
      : null;
    if (!ctPriceMode) {
      console.error(`[TE] ABORT: Price Type (LMT/MKT) missing from TL defaults for closeTrade on ${trade.tradingSymbol}. Marking close_failed.`);
      const failedUpdate = await storage.updateStrategyTrade(trade.id, { status: "close_failed", ltp: exitPrice, updatedAt: now });
      tradingCache.invalidateOpenTrades(trade.planId);
      return failedUpdate || trade;
    }
    const ctBufferSetting = await storage.getSetting("limit_order_buffer_points");
    if (!ctBufferSetting?.value && ctBufferSetting?.value !== "0") {
      console.error(`[TE] ABORT: limit_order_buffer_points is missing from app_settings. Marking close_failed for ${trade.tradingSymbol}.`);
      const failedUpd = await storage.updateStrategyTrade(trade.id, { status: "close_failed", ltp: exitPrice, updatedAt: now });
      tradingCache.invalidateOpenTrades(trade.planId);
      return failedUpd || trade;
    }
    const ctBufferPoints = parseFloat(ctBufferSetting.value);
    const ctFinalPrice = ctPriceMode === "LMT"
      ? getBufferedLimitPrice(exitPrice, exitAction, ctBufferPoints)
      : "0";

    const universalPayload: Record<string, any> = {
      tradingSymbol: trade.tradingSymbol,
      exchange: EL.mapExchange(trade.exchange),
      transactionType,
      quantity: String(trade.quantity),
      productType: trade.productType,
      priceType: mapPriceType(ctPriceMode),
      price: ctFinalPrice,
      validity: "DAY",
      afterMarket: "NO",
    };

    const orderResult = await EL.placeOrder(brokerConfig, universalPayload);
    if (!orderResult.success) {
      console.error(`[TE] Failed to close Kotak trade: ${orderResult.error}`);

      // FIX 4a: If broker says position no longer exists, treat as manually closed
      const errStr = String(orderResult.error).toLowerCase();
      if (errStr.includes("insufficient") && (errStr.includes("holding") || errStr.includes("balance"))) {
        console.warn(`[TE] Insufficient holdings for ${trade.tradingSymbol}. Marking as manually closed.`);
        const manualUpdate = await storage.updateStrategyTrade(trade.id, { status: "closed", pnl: 0, exitedAt: now, updatedAt: now, exitPrice: currentPrice, exitAction });
        tradingCache.invalidateOpenTrades(trade.planId);
        return manualUpdate || trade;
      }

      const failedUpdate = await storage.updateStrategyTrade(trade.id, { status: "close_failed", ltp: exitPrice, updatedAt: now });
      tradingCache.invalidateOpenTrades(trade.planId);
      return failedUpdate || trade;
    }

    const closeOrderId = orderResult.data?.orderNo;
    if (closeOrderId) {
      exitPrice = (await getFillPrice(brokerConfig, closeOrderId, exitPrice)).fillPrice;
    }
  }

  const entryPrice = trade.price || 0;
  const qty = trade.quantity || 1;
  const pnl = trade.action === "BUY" ? (exitPrice - entryPrice) * qty : (entryPrice - exitPrice) * qty;

  const updated = await storage.updateStrategyTrade(trade.id, {
    status: "closed", pnl: Math.round(pnl * 100) / 100, ltp: exitPrice, exitPrice, exitAction, exitedAt: now, updatedAt: now,
  });

  tradingCache.invalidateOpenTrades(trade.planId);

  const remainingOpen = await storage.getOpenTradesByPlan(trade.planId);
  if (remainingOpen.length === 0) {
    await storage.updateStrategyPlan(trade.planId, { awaitingCleanEntry: true });
    const plan = await storage.getStrategyPlan(trade.planId);
    if (plan?.configId) tradingCache.invalidatePlans(plan.configId);
  }

  return updated || trade;
}

export async function squareOffPlan(
  storage: IStorage,
  planId: string,
  brokerConfig: BrokerConfig,
): Promise<{ closed: number; failed: number; errors: string[] }> {
  const openTrades = await storage.getUnclosedTradesByPlan(planId);
  // MARGIN SAFETY: Close short positions (SELL-opened) first to free margin before closing longs
  openTrades.sort((a, b) => {
    const aFirst = a.action === "SELL";
    const bFirst = b.action === "SELL";
    return aFirst === bFirst ? 0 : aFirst ? -1 : 1;
  });
  const now = new Date().toISOString();
  const today = now.slice(0, 10);
  const plan = await storage.getStrategyPlan(planId);
  const broker = brokerConfig.brokerName;
  let closed = 0;
  let failed = 0;
  const errors: string[] = [];

  console.log(`[TE] squareOffPlan: planId=${planId}, unclosedTrades=${openTrades.length}`);

  const delaySetting = await storage.getSetting("order_execution_delay_ms");
  if (!delaySetting?.value && delaySetting?.value !== "0") {
    const abortMsg = "ABORT: order_execution_delay_ms is missing from app_settings.";
    console.error(`[TE] ${abortMsg}`);
    throw new Error(abortMsg);
  }
  const _parsedDelay = parseInt(delaySetting.value, 10);
  const delayMs = Math.max(0, _parsedDelay);

  for (const trade of openTrades) {
    try {
      const currentPrice = trade.ltp || trade.price || 0;
      const result = await closeTrade(storage, trade, currentPrice, now, brokerConfig);
      if (result.status === "closed") {
        closed++;
        const pnl = result.pnl || 0;
        deferDailyPnlUpdate(storage, planId, today, pnl);
        if (plan) {
          addProcessFlowLog({
            planId: plan.id,
            planName: plan.name,
            signalType: "square_off",
            alert: "Square off all positions",
            resolvedAction: "CLOSE",
            blockType: "square_off",
            actionTaken: "squared_off",
            message: `Squared off trade: ${trade.tradingSymbol} qty=${trade.quantity} exitPrice=${result.exitPrice} pnl=${pnl}`,
            broker,
            ticker: trade.tradingSymbol || undefined,
            exchange: trade.exchange || undefined,
            price: result.exitPrice || currentPrice,
          });
        }
      } else {
        failed++;
        const errMsg = `Failed to close trade ${trade.id} (${trade.tradingSymbol})`;
        errors.push(errMsg);
        if (plan) {
          addProcessFlowLog({
            planId: plan.id,
            planName: plan.name,
            signalType: "square_off",
            alert: "Square off all positions",
            resolvedAction: "CLOSE",
            blockType: "square_off",
            actionTaken: "close_failed",
            message: errMsg,
            broker,
            ticker: trade.tradingSymbol || undefined,
            exchange: trade.exchange || undefined,
          });
        }
      }
      // Add delay to prevent rate limits and allow RMS to update margin
      await new Promise(r => setTimeout(r, delayMs));
    } catch (err: any) {
      failed++;
      const errMsg = `Error closing trade ${trade.id}: ${err?.message || err}`;
      errors.push(errMsg);
      console.error(`[TE] ${errMsg}`);
      if (plan) {
        addProcessFlowLog({
          planId: plan.id,
          planName: plan.name,
          signalType: "square_off",
          alert: "Square off all positions",
          resolvedAction: "CLOSE",
          blockType: "square_off",
          actionTaken: "close_failed",
          message: errMsg,
          broker,
          ticker: trade.tradingSymbol || undefined,
          exchange: trade.exchange || undefined,
        });
      }
    }
  }

  tradingCache.invalidateOpenTrades(planId);
  console.log(`[TE] squareOffPlan complete: closed=${closed}, failed=${failed}`);
  return { closed, failed, errors };
}

export const persistentSquareOffActive = new Set<string>();

export function startPersistentSquareOff(
  storage: IStorage,
  planId: string,
  brokerConfig: BrokerConfig,
): void {
  if (persistentSquareOffActive.has(planId)) {
    console.log(`[TE] PersistentSquareOff already running for plan ${planId}, skipping duplicate`);
    return;
  }
  persistentSquareOffActive.add(planId);

  async function attempt() {
    const unclosed = await storage.getUnclosedTradesByPlan(planId);
    if (unclosed.length === 0) {
      console.log(`[TE] PersistentSquareOff complete — all legs exited for plan ${planId}`);
      persistentSquareOffActive.delete(planId);
      return;
    }
    console.log(`[TE] PersistentSquareOff — ${unclosed.length} unclosed leg(s) for plan ${planId}, retrying...`);
    await squareOffPlan(storage, planId, brokerConfig);
    const settingRow = await storage.getSetting("squareoff_retry_interval_ms");
    if (!settingRow?.value && settingRow?.value !== "0") {
      const abortMsg = "ABORT: squareoff_retry_interval_ms is missing from app_settings.";
      console.error(`[TE] ${abortMsg}`);
      throw new Error(abortMsg);
    }
    const intervalMs = Math.max(0, parseInt(settingRow.value, 10));
    setTimeout(attempt, intervalMs);
  }

  attempt().catch((err) => {
    console.error(`[TE] PersistentSquareOff error for plan ${planId}:`, err?.message || err);
    persistentSquareOffActive.delete(planId);
  });
}

export const persistentExitActive = new Set<string>();

export function startPersistentExit(
  storage: IStorage,
  planId: string,
  blockType: string,
  brokerConfig: BrokerConfig,
): void {
  const key = `${planId}:${blockType}`;
  if (persistentExitActive.has(key)) {
    console.log(`[TE] PersistentExit already running for plan ${planId} block ${blockType}, skipping duplicate`);
    return;
  }
  persistentExitActive.add(key);

  async function attempt() {
    const unclosed = await storage.getUnclosedTradesByPlan(planId);
    const toRetry = unclosed.filter(t => t.blockType === blockType);
    if (toRetry.length === 0) {
      console.log(`[TE] PersistentExit complete — all ${blockType} legs exited for plan ${planId}`);
      persistentExitActive.delete(key);
      return;
    }
    console.log(`[TE] PersistentExit — ${toRetry.length} unclosed ${blockType} leg(s) for plan ${planId}, retrying...`);
    const now = new Date().toISOString();
    for (const trade of toRetry) {
      const currentPrice = trade.ltp || trade.price || 0;
      await closeTrade(storage, trade, currentPrice, now, brokerConfig)
        .catch(err => console.error(`[TE] PersistentExit closeTrade error:`, err?.message || err));
    }
    tradingCache.invalidateOpenTrades(planId);
    const settingRow = await storage.getSetting("squareoff_retry_interval_ms");
    if (!settingRow?.value && settingRow?.value !== "0") {
      const abortMsg = "ABORT: squareoff_retry_interval_ms is missing from app_settings.";
      console.error(`[TE] ${abortMsg}`);
      throw new Error(abortMsg);
    }
    const intervalMs = Math.max(0, parseInt(settingRow.value, 10));
    setTimeout(attempt, intervalMs);
  }

  attempt().catch((err) => {
    console.error(`[TE] PersistentExit error for plan ${planId} block ${blockType}:`, err?.message || err);
    persistentExitActive.delete(key);
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// FIX 3c: THE PERSISTENT ROLLBACK ENGINE
// Background retry loop for legs stuck in rollback_failed or rolling_back.
// Per-trade attempt tracking via Map; fresh DB queries each cycle.
// ═══════════════════════════════════════════════════════════════════════════════
export const persistentRollbackActive = new Set<string>();
const rollbackAttempts = new Map<string, number>();

export function startPersistentRollback(
  storage: IStorage,
  planId: string,
  brokerConfig: BrokerConfig,
): void {
  if (persistentRollbackActive.has(planId)) return;
  persistentRollbackActive.add(planId);

  async function attempt() {
    try {
      // Fresh query at the START of each cycle (not stale array)
      const allTrades = await storage.getStrategyTradesByPlan(planId);
      const toRetry = allTrades.filter(t => t.status === "rollback_failed" || t.status === "rolling_back");

      if (toRetry.length === 0) {
        persistentRollbackActive.delete(planId);
        return;
      }

      const plan = await storage.getStrategyPlan(planId);
      const rbRetrySetting = await storage.getSetting("rollback_api_retry_count");
      const maxRetries = rbRetrySetting?.value ? parseInt(rbRetrySetting.value, 10) : 5;
      const now = new Date().toISOString();
      const mockWebhookData = { signalType: "rollback", alert: "Persistent Margin Recovery" } as WebhookData;

      for (const trade of toRetry) {
        const attempts = rollbackAttempts.get(trade.id) || 0;
        if (attempts >= maxRetries) {
          if (plan) logPFL(plan, brokerConfig.brokerName, mockWebhookData, "error", `[FATAL] Rollback retries exhausted for ${trade.tradingSymbol}. Manual intervention required!`);
          continue;
        }

        rollbackAttempts.set(trade.id, attempts + 1);

        const reverseAction = trade.action === "BUY" ? "SELL" : "BUY";
        const revTransactionType = mapTransactionType(reverseAction);

        const prPriceMode = TL.isReady()
          ? TL.getDefaultByUniversalName("priceType", "order_place")
          : null;
        if (!prPriceMode) {
          console.error(`[TE] ABORT: Price Type (LMT/MKT) missing from TL defaults for persistent rollback of ${trade.tradingSymbol}. Marking rollback_failed.`);
          const now2 = new Date().toISOString();
          await storage.updateStrategyTrade(trade.id, { status: "rollback_failed", updatedAt: now2 });
          continue;
        }
        if (!trade.productType) {
          console.error(`[TE] ABORT: productType missing for persistent rollback of ${trade.tradingSymbol}. Marking rollback_failed.`);
          const now2 = new Date().toISOString();
          await storage.updateStrategyTrade(trade.id, { status: "rollback_failed", updatedAt: now2 });
          continue;
        }
        const prBufferSetting = await storage.getSetting("limit_order_buffer_points");
        if (!prBufferSetting?.value && prBufferSetting?.value !== "0") {
          const abortMsg = "ABORT: limit_order_buffer_points is missing from app_settings.";
          if (plan) logPFL(plan, brokerConfig.brokerName, mockWebhookData, "error", abortMsg);
          else console.error(`[TE] ${abortMsg}`);
          continue;
        }
        const prBufferPoints = parseFloat(prBufferSetting.value);
        const prFinalPrice = prPriceMode === "LMT"
          ? getBufferedLimitPrice(trade.ltp || trade.price || 0, reverseAction, prBufferPoints)
          : "0";

        const rbResult = await EL.placeOrder(brokerConfig, {
          tradingSymbol: trade.tradingSymbol,
          exchange: EL.mapExchange(trade.exchange || "NFO"),
          transactionType: revTransactionType,
          quantity: String(trade.quantity),
          productType: trade.productType,
          priceType: mapPriceType(prPriceMode),
          price: prFinalPrice,
          validity: "DAY",
          afterMarket: "NO",
        });

        if (rbResult.success) {
          await storage.updateStrategyTrade(trade.id, { status: "rolled_back", exitedAt: now, updatedAt: now });
          if (plan) logPFL(plan, brokerConfig.brokerName, mockWebhookData, "info", `[ROLLBACK] Recovered & reversed ${trade.tradingSymbol} on retry ${attempts + 1}`);
        } else {
          await storage.updateStrategyTrade(trade.id, { status: "rollback_failed", updatedAt: now });
        }
      }

      // Fresh query at the END of the loop to check remaining (prevents stale-data infinite loop)
      const freshTrades = await storage.getStrategyTradesByPlan(planId);
      const remaining = freshTrades.filter(
        t => (t.status === "rollback_failed" || t.status === "rolling_back") && (rollbackAttempts.get(t.id) || 0) < maxRetries,
      );

      if (remaining.length > 0) {
        const settingRow = await storage.getSetting("squareoff_retry_interval_ms");
        if (!settingRow?.value && settingRow?.value !== "0") {
          const abortMsg = "ABORT: squareoff_retry_interval_ms is missing from app_settings.";
          console.error(`[TE] ${abortMsg}`);
          persistentRollbackActive.delete(planId);
          return;
        }
        const intervalMs = Math.max(0, parseInt(settingRow.value, 10));
        setTimeout(attempt, intervalMs);
      } else {
        persistentRollbackActive.delete(planId);
      }
    } catch (err) {
      console.error(`[TE] PersistentRollback error for plan ${planId}:`, err);
      persistentRollbackActive.delete(planId);
    }
  }

  attempt();
}

export const persistentEntryActive = new Set<string>();

export function startPersistentEntry(
  storage: IStorage,
  planId: string,
  brokerConfig: BrokerConfig,
  webhookDataRow: WebhookData,
  signalContext: SignalContext,
): void {
  if (persistentEntryActive.has(planId)) {
    console.log(`[TE] PersistentEntry already running for plan ${planId}, skipping duplicate`);
    return;
  }
  persistentEntryActive.add(planId);

  async function attempt() {
    const allTrades = await storage.getStrategyTradesByPlan(planId);
    const failedForSignal = allTrades.filter(
      t => t.webhookDataId === webhookDataRow.id && t.status === "failed"
    );
    if (failedForSignal.length === 0) {
      console.log(`[TE] PersistentEntry complete — all legs entered for plan ${planId}`);
      persistentEntryActive.delete(planId);
      return;
    }
    console.log(`[TE] PersistentEntry — ${failedForSignal.length} failed leg(s) for plan ${planId}, retrying...`);
    const plan = await storage.getStrategyPlan(planId);
    if (plan) {
      await executeTradeForPlan(storage, plan, brokerConfig, webhookDataRow, signalContext)
        .catch(err => console.error(`[TE] PersistentEntry retry error:`, err));
    }
    const settingRow = await storage.getSetting("squareoff_retry_interval_ms");
    const intervalMs = settingRow?.value ? parseInt(settingRow.value, 10) : 2000;
    setTimeout(attempt, intervalMs);
  }

  attempt().catch((err) => {
    console.error(`[TE] PersistentEntry error for plan ${planId}:`, err?.message || err);
    persistentEntryActive.delete(planId);
  });
}

function deferDailyPnlUpdate(storage: IStorage, planId: string, today: string, closePnl: number) {
  setTimeout(() => {
    storage.getStrategyDailyPnl(planId).then((records) => {
      const dailyPnl = records.find(r => r.date === today);
      const currentPnl = dailyPnl ? Number(dailyPnl.dailyPnl) : 0;
      if (dailyPnl) {
        storage.updateStrategyDailyPnl(dailyPnl.id, { dailyPnl: currentPnl + closePnl }).catch(console.error);
      } else {
        storage.createStrategyDailyPnl({ planId, date: today, dailyPnl: closePnl }).catch(console.error);
      }
    }).catch(console.error);
  }, 1000);
}