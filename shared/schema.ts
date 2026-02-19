import { pgTable, text, varchar, integer, bigint, real, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ====== PREDEFINED INDICATORS ======
export const PREDEFINED_INDICATORS = [
  "RSI",
  "Supertrend",
  "Half Trend",
  "EMA",
  "SMA",
  "MACD",
  "Bollinger Bands",
  "VWAP",
  "Stochastic",
  "ADX",
  "ATR",
  "Ichimoku",
  "Pivot Points",
  "Fibonacci",
  "CCI",
  "Williams %R",
  "Parabolic SAR",
  "Donchian Channel",
  "Keltner Channel",
  "OBV",
] as const;

export type PredefinedIndicator = typeof PREDEFINED_INDICATORS[number];

// ====== STRATEGY TYPES ======

export type ActionMapperEntry = {
  signalValue: string;
  fieldKey?: string;
  uptrend: "ENTRY" | "EXIT" | "HOLD" | "--" | null;
  downtrend: "ENTRY" | "EXIT" | "HOLD" | "--" | null;
  neutral: "ENTRY" | "EXIT" | "HOLD" | "--" | null;
};

export type TradeLeg = {
  type: "CE" | "PE" | "FUT";
  action: "BUY" | "SELL";
  strike: string;
  lots: number;
};

export type ExecutionBlock = {
  legs: TradeLeg[];
};

export type PlanTradeLeg = {
  type: "CE" | "PE" | "FUT";
  action: "BUY" | "SELL";
  strike: string;
  lots: number;
  orderType: "MIS" | "NRML" | "CNC";
  exchange?: string;
};

export type StoplossConfig = {
  enabled: boolean;
  mode: "amount" | "percentage";
  value: number;
};

export type ProfitTargetConfig = {
  enabled: boolean;
  mode: "amount" | "percentage";
  value: number;
};

export type TrailingStoplossConfig = {
  enabled: boolean;
  activateAt: number;
  lockProfitAt: number;
  whenProfitIncreaseBy: number;
  increaseTslBy: number;
};

export type TimeLogicConfig = {
  exitTime: string;
  exitOnExpiry: boolean;
  exitAfterDays: number;
};

export type TradeParams = {
  legs: PlanTradeLeg[];
  uptrendLegs?: PlanTradeLeg[];
  downtrendLegs?: PlanTradeLeg[];
  neutralLegs?: PlanTradeLeg[];
  stoploss?: StoplossConfig;
  profitTarget?: ProfitTargetConfig;
  trailingSL?: TrailingStoplossConfig;
  timeLogic?: TimeLogicConfig;
};

// ====== STRATEGY MOTHER CONFIGURATOR ======
// Created by Super Admin only - defines the master template
export const strategyConfigs = pgTable("strategy_configs", {
  id: varchar("id", { length: 36 }).primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  webhookId: varchar("webhook_id", { length: 36 }),
  exchange: text("exchange"),
  ticker: text("ticker"),
  indicators: text("indicators").array(),
  actionMapper: text("action_mapper"),
  uptrendBlock: text("uptrend_block"),
  downtrendBlock: text("downtrend_block"),
  neutralBlock: text("neutral_block"),
  status: text("status").notNull().default("draft"),
  createdBy: varchar("created_by", { length: 36 }),
  createdAt: text("created_at"),
  updatedAt: text("updated_at"),
});

export const insertStrategyConfigSchema = createInsertSchema(strategyConfigs).omit({ id: true });
export type InsertStrategyConfig = z.infer<typeof insertStrategyConfigSchema>;
export type StrategyConfig = typeof strategyConfigs.$inferSelect;

// ====== STRATEGY TRADE PLANS ======
// Created by Team Members + Super Admin based on a Mother Config
export const strategyPlans = pgTable("strategy_plans", {
  id: varchar("id", { length: 36 }).primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  configId: varchar("config_id", { length: 36 }).notNull(),
  selectedIndicators: text("selected_indicators").array(),
  tradeParams: text("trade_params"),
  status: text("status").notNull().default("draft"),
  brokerConfigId: varchar("broker_config_id", { length: 36 }),
  isProxyMode: boolean("is_proxy_mode").default(false),
  createdBy: varchar("created_by", { length: 36 }),
  createdAt: text("created_at"),
  updatedAt: text("updated_at"),
});

export const insertStrategyPlanSchema = createInsertSchema(strategyPlans).omit({ id: true });
export type InsertStrategyPlan = z.infer<typeof insertStrategyPlanSchema>;
export type StrategyPlan = typeof strategyPlans.$inferSelect;

// Legacy strategy table kept for backward compatibility
export const strategies = pgTable("strategies", {
  id: varchar("id", { length: 36 }).primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  type: text("type").notNull(),
  status: text("status").notNull().default("inactive"),
  symbol: text("symbol").notNull(),
  exchange: text("exchange").notNull().default("NSE"),
  quantity: integer("quantity").notNull().default(1),
  entryCondition: text("entry_condition"),
  exitCondition: text("exit_condition"),
  stopLoss: real("stop_loss"),
  targetProfit: real("target_profit"),
  totalTrades: integer("total_trades").default(0),
  winningTrades: integer("winning_trades").default(0),
  profitLoss: real("profit_loss").default(0),
});

export const insertStrategySchema = createInsertSchema(strategies).omit({ id: true });
export type InsertStrategy = z.infer<typeof insertStrategySchema>;
export type Strategy = typeof strategies.$inferSelect;

// Field configuration type for webhook tables
export type WebhookFieldConfig = {
  name: string; // Display name (e.g., "Time Unix")
  key: string; // Database/JSON key (e.g., "time_unix")
  type: "text" | "number" | "timestamp"; // Data type
  order: number; // Display order
};

// Webhook Registry - Central table for all webhook unique codes (past and present)
// Super admin and team members can access this for tracking and lookup
export const webhookRegistry = pgTable("webhook_registry", {
  id: varchar("id", { length: 36 }).primaryKey(),
  uniqueCode: varchar("unique_code", { length: 8 }).notNull().unique(), // Globally unique code
  webhookId: varchar("webhook_id", { length: 36 }), // Null if webhook deleted
  webhookName: text("webhook_name").notNull(), // Name at time of creation
  createdBy: varchar("created_by", { length: 36 }), // User who created it
  createdAt: timestamp("created_at").defaultNow().notNull(),
  isActive: boolean("is_active").notNull().default(true), // False if webhook deleted
  deletedAt: timestamp("deleted_at"), // When webhook was deleted (if applicable)
  notes: text("notes"), // Optional notes/description
});

export const insertWebhookRegistrySchema = createInsertSchema(webhookRegistry).omit({ id: true, createdAt: true });
export type InsertWebhookRegistry = z.infer<typeof insertWebhookRegistrySchema>;
export type WebhookRegistry = typeof webhookRegistry.$inferSelect;

// Webhook Configuration
export const webhooks = pgTable("webhooks", {
  id: varchar("id", { length: 36 }).primaryKey(),
  uniqueCode: varchar("unique_code", { length: 8 }).notNull(), // Short unique code for linking (e.g., "WH-A1B2C3")
  name: text("name").notNull(),
  strategyId: varchar("strategy_id", { length: 36 }),
  webhookUrl: text("webhook_url").notNull(),
  secretKey: text("secret_key"),
  isActive: boolean("is_active").notNull().default(true),
  triggerType: text("trigger_type").notNull(), // "entry", "exit", "both"
  lastTriggered: text("last_triggered"),
  totalTriggers: integer("total_triggers").default(0),
  fieldConfig: text("field_config"), // JSON array of WebhookFieldConfig
  dataTableName: text("data_table_name"), // Dynamic table name for this webhook's data
  linkedWebhookId: varchar("linked_webhook_id", { length: 36 }), // Link to production webhook by unique_code
  linkedByWebhooks: text("linked_by_webhooks").array(), // Array of dev webhook codes that link to this production webhook
});

export const insertWebhookSchema = createInsertSchema(webhooks).omit({ id: true, uniqueCode: true });
export type InsertWebhook = z.infer<typeof insertWebhookSchema>;
export type Webhook = typeof webhooks.$inferSelect;

// Webhook Logs - TradingView alert data
export const webhookLogs = pgTable("webhook_logs", {
  id: varchar("id", { length: 36 }).primaryKey(),
  webhookId: varchar("webhook_id", { length: 36 }).notNull(),
  timestamp: text("timestamp").notNull(),
  payload: text("payload"),
  status: text("status").notNull(), // "success", "failed", "pending"
  response: text("response"),
  executionTime: integer("execution_time"),
  
  // Request metadata
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  
  // TradingView alert fields
  timeUnix: bigint("time_unix", { mode: "number" }),
  exchange: text("exchange"),
  indices: text("indices"),
  indicator: text("indicator"),
  alert: text("alert"),
  price: real("price"),
  localTime: text("local_time"),
  mode: text("mode"),
  modeDesc: text("mode_desc"),
  firstLine: real("first_line"),
  midLine: real("mid_line"),
  slowLine: real("slow_line"),
  st: real("st"),
  ht: real("ht"),
  rsi: real("rsi"),
  rsiScaled: real("rsi_scaled"),
  alertSystem: text("alert_system"),
  actionBinary: integer("action_binary"), // 1 = BUY, 0 = SELL
  lockState: text("lock_state"),
});

export const insertWebhookLogSchema = createInsertSchema(webhookLogs).omit({ id: true });
export type InsertWebhookLog = z.infer<typeof insertWebhookLogSchema>;
export type WebhookLog = typeof webhookLogs.$inferSelect;

// Webhook Test/Status Logs
export const webhookStatusLogs = pgTable("webhook_status_logs", {
  id: varchar("id", { length: 36 }).primaryKey(),
  webhookId: varchar("webhook_id", { length: 36 }).notNull(),
  testPayload: text("test_payload"),
  status: text("status").notNull(), // "success", "failed"
  statusCode: integer("status_code"),
  responseMessage: text("response_message"),
  errorMessage: text("error_message"),
  responseTime: integer("response_time"), // Response time in ms
  testedAt: text("tested_at").notNull(),
});

export const insertWebhookStatusLogSchema = createInsertSchema(webhookStatusLogs).omit({ id: true });
export type InsertWebhookStatusLog = z.infer<typeof insertWebhookStatusLogSchema>;
export type WebhookStatusLog = typeof webhookStatusLogs.$inferSelect;

// Webhook Data - stores incoming JSON data from webhooks for strategy access
export const webhookData = pgTable("webhook_data", {
  id: varchar("id", { length: 36 }).primaryKey(),
  webhookId: varchar("webhook_id", { length: 36 }).notNull(),
  strategyId: varchar("strategy_id", { length: 36 }),
  webhookName: text("webhook_name"),
  receivedAt: text("received_at").notNull(),
  
  // Raw JSON data
  rawPayload: text("raw_payload"),
  
  // Parsed TradingView signal fields
  timeUnix: bigint("time_unix", { mode: "number" }),
  exchange: text("exchange"),
  indices: text("indices"),
  indicator: text("indicator"),
  alert: text("alert"),
  price: real("price"),
  localTime: text("local_time"),
  mode: text("mode"),
  modeDesc: text("mode_desc"),
  firstLine: real("first_line"),
  midLine: real("mid_line"),
  slowLine: real("slow_line"),
  st: real("st"),
  ht: real("ht"),
  rsi: real("rsi"),
  rsiScaled: real("rsi_scaled"),
  alertSystem: text("alert_system"),
  actionBinary: integer("action_binary"), // 1 = BUY, 0 = SELL
  lockState: text("lock_state"),
  
  // Additional computed fields
  signalType: text("signal_type"), // "buy", "sell", "hold"
  isProcessed: boolean("is_processed").default(false),
  processedAt: text("processed_at"),
});

export const insertWebhookDataSchema = createInsertSchema(webhookData).omit({ id: true });
export type InsertWebhookData = z.infer<typeof insertWebhookDataSchema>;
export type WebhookData = typeof webhookData.$inferSelect;

// App Settings (for domain name, etc.)
export const appSettings = pgTable("app_settings", {
  id: varchar("id", { length: 36 }).primaryKey(),
  key: text("key").notNull(),
  value: text("value").notNull(),
  createdAt: text("created_at"),
  updatedAt: text("updated_at"),
});

export const insertAppSettingSchema = createInsertSchema(appSettings).omit({ id: true });
export type InsertAppSetting = z.infer<typeof insertAppSettingSchema>;
export type AppSetting = typeof appSettings.$inferSelect;

// Broker API Configuration - stored in "algo_trading" database
export const brokerConfigs = pgTable("broker_configs", {
  id: varchar("id", { length: 36 }).primaryKey(),
  brokerName: text("broker_name").notNull(), // "kotak_neo", "zerodha", "angel"
  consumerKey: text("consumer_key"),
  consumerSecret: text("consumer_secret"),
  mobileNumber: text("mobile_number"),
  ucc: text("ucc"), // Unique Client Code for Kotak Neo
  mpin: text("mpin"), // 6-digit MPIN for Kotak Neo
  
  // Session data
  isConnected: boolean("is_connected").notNull().default(false),
  accessToken: text("access_token"),
  sessionId: text("session_id"),
  baseUrl: text("base_url"), // Dynamic trading API base URL from Kotak Neo
  viewToken: text("view_token"), // Token from TOTP login step
  sidView: text("sid_view"), // Session ID from TOTP login step
  
  // TOTP tracking
  lastTotpUsed: text("last_totp_used"), // Last TOTP entered (for logging)
  lastTotpTime: text("last_totp_time"), // When TOTP was last used
  
  // Connection tracking
  lastConnected: text("last_connected"),
  connectionError: text("connection_error"),
  totalLogins: integer("total_logins").default(0),
  successfulLogins: integer("successful_logins").default(0),
  failedLogins: integer("failed_logins").default(0),
  
  // Test tracking
  lastTestTime: text("last_test_time"),
  lastTestResult: text("last_test_result"), // "success" or "failed"
  lastTestMessage: text("last_test_message"),
  totalTests: integer("total_tests").default(0),
  successfulTests: integer("successful_tests").default(0),
  
  // Timestamps
  createdAt: text("created_at"),
  updatedAt: text("updated_at"),
});

export const insertBrokerConfigSchema = createInsertSchema(brokerConfigs).omit({ id: true });
export type InsertBrokerConfig = z.infer<typeof insertBrokerConfigSchema>;
export type BrokerConfig = typeof brokerConfigs.$inferSelect;

// Broker Test Connection Logs
export const brokerTestLogs = pgTable("broker_test_logs", {
  id: varchar("id", { length: 36 }).primaryKey(),
  brokerConfigId: varchar("broker_config_id", { length: 36 }).notNull(),
  status: text("status").notNull(), // "success", "failed"
  message: text("message"),
  errorMessage: text("error_message"),
  responseTime: integer("response_time"), // ms
  testedAt: text("tested_at").notNull(),
});

export const insertBrokerTestLogSchema = createInsertSchema(brokerTestLogs).omit({ id: true });
export type InsertBrokerTestLog = z.infer<typeof insertBrokerTestLogSchema>;
export type BrokerTestLog = typeof brokerTestLogs.$inferSelect;

// Broker Session Logs - one entry per TOTP login
export const brokerSessionLogs = pgTable("broker_session_logs", {
  id: varchar("id", { length: 36 }).primaryKey(),
  brokerConfigId: varchar("broker_config_id", { length: 36 }).notNull(),
  status: text("status").notNull(), // "success", "failed"
  message: text("message"),
  errorMessage: text("error_message"),
  totpUsed: text("totp_used"),
  accessToken: text("access_token"),
  sessionId: text("session_id"),
  baseUrl: text("base_url"),
  sessionExpiry: text("session_expiry"), // ISO datetime when session expires (from JWT exp)
  loginAt: text("login_at").notNull(),
});

export const insertBrokerSessionLogSchema = createInsertSchema(brokerSessionLogs).omit({ id: true });
export type InsertBrokerSessionLog = z.infer<typeof insertBrokerSessionLogSchema>;
export type BrokerSessionLog = typeof brokerSessionLogs.$inferSelect;

// Position
export interface Position {
  trading_symbol: string;
  exchange: string;
  quantity: number;
  buy_avg: number;
  sell_avg: number;
  pnl: number;
  ltp: number;
  product_type?: string; // NRML, MIS, CNC, PAY LATER
  option_type?: string; // CALL, PUT
  strike_price?: number;
  expiry?: string;
  realised_pnl?: number;
  unrealised_pnl?: number;
}

// Order
export interface Order {
  order_id: string;
  trading_symbol: string;
  transaction_type: string; // "B", "S"
  quantity: number;
  price: number;
  status: string; // "PENDING", "COMPLETE", "REJECTED", "CANCELLED"
  order_type: string;
  exchange: string;
  timestamp: string;
}

// Holding - matches Kotak Neo INVESTMENTS layout
export interface Holding {
  trading_symbol: string;
  quantity: number;
  average_price: number;   // Avg cost
  current_price: number;   // LTP (Last Traded Price)
  invested_value: number;  // quantity * average_price
  current_value: number;   // quantity * current_price (market value)
  pnl: number;             // Profit/Loss amount
  pnl_percent: number;     // Profit/Loss percentage
  today_pnl: number;       // Today's P/L amount
  today_pnl_percent: number; // Today's P/L percentage
  prev_close?: number;     // Previous day closing price
}

// Portfolio Summary
export interface PortfolioSummary {
  totalValue: number;
  dayPnL: number;
  totalPnL: number;
  availableMargin: number;
}

// Login Credentials for Kotak Neo
export interface LoginCredentials {
  consumer_key: string;
  mobile_number: string;
  ucc: string;
  mpin: string;
  totp: string; // 6-digit TOTP from authenticator app
}

// Kotak Neo API Response
export interface KotakNeoAuthResponse {
  success: boolean;
  message: string;
  accessToken?: string;
  sessionId?: string;
  baseUrl?: string;
  error?: string;
}

// Order Params
export interface OrderParams {
  exchange_segment: string;
  product: string;
  price: string;
  order_type: string;
  quantity: string;
  validity: string;
  trading_symbol: string;
  transaction_type: string;
  amo?: string;
  disclosed_quantity?: string;
  market_protection?: string;
  pf?: string;
  trigger_price?: string;
}

// ====== BROKER FIELD CORRELATION MAP ======
// Maps strategy/plan parameters to Kotak Neo API field codes
// Reference: broker-api.tsx order placement fields

export const BROKER_FIELD_MAP = {
  // Transaction Type: BUY/SELL → tt: B/S
  transactionType: {
    brokerField: "tt",
    values: { BUY: "B", SELL: "S" },
  },
  // Product Code: MIS/NRML/CNC → pc
  orderType: {
    brokerField: "pc",
    values: { MIS: "MIS", NRML: "NRML", CNC: "CNC" },
  },
  // Exchange Segment: NSE/BSE/NFO/MCX → es
  exchange: {
    brokerField: "es",
    values: {
      NSE: "nse_cm",
      BSE: "bse_cm",
      NFO: "nse_fo",
      BFO: "bse_fo",
      MCX: "mcx_fo",
      CDS: "cde_fo",
    },
  },
  // Option Type mapping for symbol construction
  optionType: {
    brokerField: "ts",
    values: { CE: "CE", PE: "PE", FUT: "XX" },
  },
} as const;

export type BrokerFieldMapKey = keyof typeof BROKER_FIELD_MAP;

export function buildTradingSymbol(ticker: string, legType: string, strike: string): string {
  if (!ticker) return "";
  if (legType === "FUT") return `${ticker}-FUT`;
  const strikeLabel = strike || "ATM";
  return `${ticker}-${strikeLabel}-${legType}`;
}

export function buildBrokerOrderParams(leg: PlanTradeLeg, config: { exchange?: string | null; ticker?: string | null }): Partial<OrderParams> {
  const exchange = leg.exchange || config.exchange || "NFO";
  const ticker = config.ticker || "";
  const ts = buildTradingSymbol(ticker, leg.type, leg.strike);
  return {
    transaction_type: BROKER_FIELD_MAP.transactionType.values[leg.action] || "B",
    product: BROKER_FIELD_MAP.orderType.values[leg.orderType] || "MIS",
    exchange_segment: BROKER_FIELD_MAP.exchange.values[exchange as keyof typeof BROKER_FIELD_MAP.exchange.values] || "nse_fo",
    quantity: String(leg.lots),
    order_type: "MKT",
    validity: "DAY",
    price: "0",
    trading_symbol: ts,
  };
}

// Export auth models (users, sessions, invitations)
export * from "./models/auth";
