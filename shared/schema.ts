import { pgTable, text, varchar, integer, real, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Trading Strategy
export const strategies = pgTable("strategies", {
  id: varchar("id", { length: 36 }).primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  type: text("type").notNull(), // "momentum", "mean_reversion", "arbitrage", "trend_following"
  status: text("status").notNull().default("inactive"), // "active", "inactive", "paused"
  riskLevel: text("risk_level").notNull().default("medium"), // "low", "medium", "high"
  allocation: real("allocation").notNull().default(0), // percentage of portfolio
  profitTarget: real("profit_target"), // percentage
  stopLoss: real("stop_loss"), // percentage
  winRate: real("win_rate").default(0),
  totalTrades: integer("total_trades").default(0),
  profitLoss: real("profit_loss").default(0),
});

export const insertStrategySchema = createInsertSchema(strategies).omit({ id: true });
export type InsertStrategy = z.infer<typeof insertStrategySchema>;
export type Strategy = typeof strategies.$inferSelect;

// Trade
export const trades = pgTable("trades", {
  id: varchar("id", { length: 36 }).primaryKey(),
  strategyId: varchar("strategy_id", { length: 36 }).notNull(),
  symbol: text("symbol").notNull(),
  side: text("side").notNull(), // "buy", "sell"
  quantity: real("quantity").notNull(),
  entryPrice: real("entry_price").notNull(),
  exitPrice: real("exit_price"),
  profitLoss: real("profit_loss"),
  status: text("status").notNull(), // "open", "closed", "pending"
  timestamp: text("timestamp").notNull(),
});

export const insertTradeSchema = createInsertSchema(trades).omit({ id: true });
export type InsertTrade = z.infer<typeof insertTradeSchema>;
export type Trade = typeof trades.$inferSelect;

// Position
export const positions = pgTable("positions", {
  id: varchar("id", { length: 36 }).primaryKey(),
  symbol: text("symbol").notNull(),
  quantity: real("quantity").notNull(),
  averagePrice: real("average_price").notNull(),
  currentPrice: real("current_price").notNull(),
  profitLoss: real("profit_loss").notNull(),
  profitLossPercent: real("profit_loss_percent").notNull(),
});

export const insertPositionSchema = createInsertSchema(positions).omit({ id: true });
export type InsertPosition = z.infer<typeof insertPositionSchema>;
export type Position = typeof positions.$inferSelect;

// Portfolio Stats
export interface PortfolioStats {
  totalValue: number;
  dayChange: number;
  dayChangePercent: number;
  totalProfitLoss: number;
  totalProfitLossPercent: number;
  buyingPower: number;
}

// Performance Data Point for charts
export interface PerformanceDataPoint {
  date: string;
  value: number;
  benchmark?: number;
}

// Market Data
export interface MarketData {
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
}
