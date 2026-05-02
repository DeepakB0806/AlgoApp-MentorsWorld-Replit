import type { Express } from "express";
import type { IStorage } from "../storage";
import { z } from "zod";

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const exchangeUpdateSchema = z.object({
  marketOpenTime:  z.string().regex(TIME_RE, "Must be HH:MM").optional(),
  marketCloseTime: z.string().regex(TIME_RE, "Must be HH:MM").optional(),
  displayName:     z.string().min(1).max(64).optional(),
  isActive:        z.boolean().optional(),
});

const indexExpiryUpdateSchema = z.object({
  defaultExpiryDay: z.number().int().min(0).max(6).optional(),
  exchange:         z.string().min(1).max(10).optional(),
  isActive:         z.boolean().optional(),
});

export function registerMarketCalendarRoutes(app: Express, storage: IStorage) {

  // ── Exchange Settings ─────────────────────────────────────────────────────

  app.get("/api/market-calendar/exchange-settings", async (_req, res) => {
    try {
      const rows = await storage.getExchangeSettings();
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/market-calendar/exchange-settings/:exchange", async (req, res) => {
    try {
      const { exchange } = req.params;
      const parsed = exchangeUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
        return;
      }
      const updated = await storage.upsertExchangeSetting(exchange, parsed.data);
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Index Expiry Settings ─────────────────────────────────────────────────

  app.get("/api/market-calendar/index-expiry-settings", async (_req, res) => {
    try {
      const rows = await storage.getIndexExpirySettings();
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/market-calendar/index-expiry-settings/:indexName", async (req, res) => {
    try {
      const { indexName } = req.params;
      const parsed = indexExpiryUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
        return;
      }
      const updated = await storage.upsertIndexExpirySetting(indexName, parsed.data);
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Market Holidays ───────────────────────────────────────────────────────

  app.get("/api/market-calendar/holidays", async (req, res) => {
    try {
      const year = req.query.year ? parseInt(req.query.year as string) : undefined;
      const exchange = req.query.exchange as string | undefined;
      const rows = await storage.getMarketHolidays(year, exchange);
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  const DATE_YYYYMMDD = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/;

  const uploadSchema = z.object({
    year: z.number().int().min(2020).max(2100),
    exchange: z.string().min(1).max(10),
    rows: z.array(z.object({
      date: z.string().regex(DATE_YYYYMMDD, "Date must be YYYY-MM-DD"),
      description: z.string().min(1).max(255),
    })).min(1),
  });

  app.post("/api/market-calendar/holidays/upload", async (req, res) => {
    try {
      const parsed = uploadSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
        return;
      }
      const { year, exchange, rows } = parsed.data;
      const holidayRows = rows.map((r) => ({
        date: r.date,
        description: r.description,
        year,
        exchange,
        isTradingHoliday: true as const,
      }));
      const count = await storage.bulkReplaceMarketHolidays(year, exchange, holidayRows);
      res.json({ inserted: count, year, exchange });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
}
