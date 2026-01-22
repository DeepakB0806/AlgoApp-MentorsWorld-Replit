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
});

export const insertWebhookSchema = createInsertSchema(webhooks).omit({ id: true });
export type InsertWebhook = z.infer<typeof insertWebhookSchema>;
export type Webhook = typeof webhooks.$inferSelect;

// Webhook Logs
export const webhookLogs = pgTable("webhook_logs", {
  id: varchar("id", { length: 36 }).primaryKey(),
  webhookId: varchar("webhook_id", { length: 36 }).notNull(),
  timestamp: text("timestamp").notNull(),
  payload: text("payload"),
  status: text("status").notNull(), // "success", "failed", "pending"
  response: text("response"),
  executionTime: integer("execution_time"),
});

export const insertWebhookLogSchema = createInsertSchema(webhookLogs).omit({ id: true });
export type InsertWebhookLog = z.infer<typeof insertWebhookLogSchema>;
export type WebhookLog = typeof webhookLogs.$inferSelect;

// Broker API Configuration
export const brokerConfigs = pgTable("broker_configs", {
  id: varchar("id", { length: 36 }).primaryKey(),
  brokerName: text("broker_name").notNull(), // "kotak_neo", "zerodha", "angel"
  consumerKey: text("consumer_key"),
  consumerSecret: text("consumer_secret"),
  mobileNumber: text("mobile_number"),
  ucc: text("ucc"), // Unique Client Code for Kotak Neo
  mpin: text("mpin"), // 6-digit MPIN for Kotak Neo
  isConnected: boolean("is_connected").notNull().default(false),
  lastConnected: text("last_connected"),
  connectionError: text("connection_error"),
  accessToken: text("access_token"),
  sessionId: text("session_id"),
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

// Holding
export interface Holding {
  trading_symbol: string;
  quantity: number;
  average_price: number;
  current_price: number;
  pnl: number;
  pnl_percent: number;
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
