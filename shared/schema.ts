import { pgTable, text, varchar, integer, real, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Trading Strategy
export const strategies = pgTable("strategies", {
  id: varchar("id", { length: 36 }).primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  type: text("type").notNull(), // "scalping", "swing", "positional", "intraday"
  status: text("status").notNull().default("inactive"), // "active", "inactive", "paused"
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

// Webhook Configuration
export const webhooks = pgTable("webhooks", {
  id: varchar("id", { length: 36 }).primaryKey(),
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
});

export const insertWebhookSchema = createInsertSchema(webhooks).omit({ id: true });
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
  timeUnix: integer("time_unix"),
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
  mt: real("mt"),
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
  timeUnix: integer("time_unix"),
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
  mt: real("mt"),
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

// Keep User schema for compatibility
export const users = pgTable("users", {
  id: varchar("id", { length: 36 }).primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
