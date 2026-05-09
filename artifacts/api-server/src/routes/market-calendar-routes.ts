import type { Express } from "express";
import type { IStorage } from "../storage";
import { z } from "zod/v4";

// ── NSE / BSE holiday fetch helpers ──────────────────────────────────────────

const MONTH_MAP: Record<string, string> = {
  Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
  Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
};

function parseDDMMMYYYY(raw: string): string | null {
  const parts = raw.trim().split("-");
  if (parts.length !== 3) return null;
  const [dd, mmm, yyyy] = parts;
  const mm = MONTH_MAP[mmm];
  if (!mm) return null;
  return `${yyyy}-${mm}-${dd.padStart(2, "0")}`;
}

const NSE_HEADERS = {
  "User-Agent":      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept":          "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  "Referer":         "https://www.nseindia.com/",
};

async function fetchNseHolidayData(year: number): Promise<Array<{ date: string; description: string }>> {
  // Step 1 — establish session cookie
  const homeRes = await fetch("https://www.nseindia.com/", {
    headers: {
      "User-Agent":      NSE_HEADERS["User-Agent"],
      "Accept":          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
    signal: AbortSignal.timeout(12000),
  });
  const rawCookies = homeRes.headers.getSetCookie?.() ?? [];
  const cookieStr  = rawCookies.map((c: string) => c.split(";")[0]).join("; ");

  // Step 2 — fetch trading holidays
  const apiRes = await fetch("https://www.nseindia.com/api/holiday-master?type=trading", {
    headers: { ...NSE_HEADERS, Cookie: cookieStr },
    signal: AbortSignal.timeout(12000),
  });
  if (!apiRes.ok) throw new Error(`NSE API responded with HTTP ${apiRes.status}`);

  const data = await apiRes.json() as Record<string, any[]>;

  // NSE returns { CM: [...], FO: [...], IRD: [...], ... }
  // Merge CM (cash market) and FO (F&O) — FO occasionally has extra clearing holidays.
  // Deduplicate by date; FO entry wins on collision so F&O-specific closures are preserved.
  const cmList: any[] = data.CM ?? data.cm ?? [];
  const foList: any[] = data.FO ?? data.fo ?? [];
  const combined = [...cmList, ...foList];

  const seen = new Map<string, { date: string; description: string }>();
  for (const h of combined) {
    const raw = h.tradingDate ?? h.trade_date ?? h.date ?? "";
    const isoDate = parseDDMMMYYYY(String(raw));
    if (!isoDate || !isoDate.startsWith(String(year))) continue;
    seen.set(isoDate, {
      date:        isoDate,
      description: String(h.description ?? h.desc ?? h.holidayName ?? "Market Holiday").trim(),
    });
  }
  return Array.from(seen.values());
}

async function fetchBseHolidayData(year: number): Promise<Array<{ date: string; description: string }>> {
  // BSE publishes trading holidays via their public API — no session cookie required.
  const apiRes = await fetch(
    `https://api.bseindia.com/BseIndiaAPI/api/DefaultData/w?flag=0&page=1&pageSize=50&searchtext=&category=Holidays`,
    {
      headers: {
        "User-Agent":   NSE_HEADERS["User-Agent"],
        "Accept":       "application/json, text/plain, */*",
        "Origin":       "https://www.bseindia.com",
        "Referer":      "https://www.bseindia.com/",
      },
      signal: AbortSignal.timeout(12000),
    }
  );
  if (!apiRes.ok) throw new Error(`BSE API responded with HTTP ${apiRes.status}`);

  const data = await apiRes.json();

  // BSE response shape variants: array at root, or nested under Table/data/result
  const list: any[] = Array.isArray(data)
    ? data
    : (data.Table ?? data.data ?? data.result ?? data.HolidayList ?? []);

  if (!Array.isArray(list) || list.length === 0) {
    throw new Error("BSE API returned an unrecognised response format or empty list");
  }

  const holidays: Array<{ date: string; description: string }> = [];
  for (const h of list) {
    // Try all known BSE date field variants
    const rawDate =
      h.tradingDate ?? h.trade_date ?? h.HolidayDate ?? h.holiday_date ??
      h.TradeDate ?? h.Date ?? h.date ?? "";
    const rawDesc =
      h.description ?? h.Description ?? h.desc ?? h.HolidayDescription ??
      h.holiday_description ?? h.Reason ?? "";

    // BSE dates may be DD-MMM-YYYY or YYYY-MM-DD or DD/MM/YYYY
    let isoDate: string | null = null;
    const s = String(rawDate).trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
      isoDate = s.slice(0, 10); // already YYYY-MM-DD
    } else if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) {
      const [d2, m2, y2] = s.split("/");
      isoDate = `${y2}-${m2}-${d2}`;
    } else {
      isoDate = parseDDMMMYYYY(s);
    }

    if (!isoDate || !isoDate.startsWith(String(year))) continue;
    holidays.push({
      date:        isoDate,
      description: String(rawDesc || "Market Holiday").trim(),
    });
  }
  return holidays;
}

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
      await storage.setSetting(`holiday_last_sync_${exchange}_${year}`, new Date().toISOString());
      res.json({ inserted: count, year, exchange });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Auto-sync from NSE/BSE ─────────────────────────────────────────────────

  const syncSchema = z.object({
    year:     z.number().int().min(2020).max(2100),
    exchange: z.enum(["NSE", "BSE"]),
  });

  app.get("/api/market-calendar/holidays/sync-status-all", async (req, res) => {
    try {
      const year = req.query.year ? parseInt(req.query.year as string) : new Date().getFullYear();
      const exchanges = ["NSE", "BSE", "MCX"] as const;
      const results = await Promise.all(
        exchanges.map(async (ex) => {
          const [rows, setting] = await Promise.all([
            storage.getMarketHolidays(year, ex),
            storage.getSetting(`holiday_last_sync_${ex}_${year}`),
          ]);
          return { exchange: ex, count: rows.length, lastSyncedAt: setting?.value ?? null };
        })
      );
      const out: Record<string, { count: number; lastSyncedAt: string | null }> = {};
      for (const r of results) out[r.exchange] = { count: r.count, lastSyncedAt: r.lastSyncedAt };
      res.json({ year, ...out });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/market-calendar/holidays/sync-status", async (req, res) => {
    try {
      const year     = req.query.year ? parseInt(req.query.year as string) : new Date().getFullYear();
      const exchange = (req.query.exchange as string | undefined) ?? "NSE";
      const rows     = await storage.getMarketHolidays(year, exchange);
      const setting  = await storage.getSetting(`holiday_last_sync_${exchange}_${year}`);
      res.json({ count: rows.length, lastSyncedAt: setting?.value ?? null, year, exchange });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/market-calendar/holidays/sync-nse", async (req, res) => {
    const parsed = syncSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
      return;
    }
    const { year, exchange } = parsed.data;
    const sourceName = "NSE";
    try {
      // BSE and NSE share identical trading holidays (confirmed by operator).
      // fetchBseHolidayData() hits api.bseindia.com which is unreliable in server env.
      // For both exchanges: fetch from NSE and store under the requested exchange label.
      const holidays = await fetchNseHolidayData(year);

      if (holidays.length === 0) {
        res.status(502).json({
          error: `No holidays found for ${year} in ${sourceName} response. ${sourceName} may not have published ${year} holidays yet, or the connection was blocked.`,
        });
        return;
      }
      const rows = holidays.map((h) => ({
        date: h.date,
        description: h.description,
        year,
        exchange,
        isTradingHoliday: true as const,
      }));
      // No-partial-write: only save after full successful fetch + parse
      const inserted = await storage.bulkReplaceMarketHolidays(year, exchange, rows);
      await storage.setSetting(`holiday_last_sync_${exchange}_${year}`, new Date().toISOString());
      res.json({ inserted, year, exchange });
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      const isNetworkErr = msg.includes("fetch") || msg.includes("timeout") || msg.includes("ENOTFOUND") || msg.includes("HTTP 4") || msg.includes("HTTP 5");
      res.status(502).json({
        error: isNetworkErr
          ? `Could not reach ${sourceName} (${msg}). Use CSV upload as backup.`
          : `Sync failed: ${msg}`,
      });
    }
  });
}
