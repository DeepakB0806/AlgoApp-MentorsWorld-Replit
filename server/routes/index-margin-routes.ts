import type { Express } from "express";
import type { IStorage } from "../storage";
import { z } from "zod";

// Per-index canonical defaults — source of truth from SEBI/NSE/BSE regulations.
// These are applied on first seed AND used to correct rows that still hold the
// old placeholder value (lotSize === 1), indicating they were never admin-edited.
const INDEX_DEFAULTS: Record<string, {
  exchange: string;
  expiryCycle: "Weekly & Monthly" | "Monthly ONLY";
  expiryDay: string;
  lotSize: number;
  strikeInterval: number;
  spanRate: string;
  expiryMultiplier: string;
}> = {
  NIFTY:      { exchange: "NFO", expiryCycle: "Weekly & Monthly", expiryDay: "Tuesday",      lotSize: 75,  strikeInterval: 50,  spanRate: "10.0", expiryMultiplier: "1.16" },
  BANKNIFTY:  { exchange: "NFO", expiryCycle: "Monthly ONLY",     expiryDay: "Last Tuesday", lotSize: 30,  strikeInterval: 100, spanRate: "12.0", expiryMultiplier: "1.14" },
  FINNIFTY:   { exchange: "NFO", expiryCycle: "Monthly ONLY",     expiryDay: "Last Tuesday", lotSize: 65,  strikeInterval: 50,  spanRate: "11.0", expiryMultiplier: "1.15" },
  MIDCPNIFTY: { exchange: "NFO", expiryCycle: "Monthly ONLY",     expiryDay: "Last Tuesday", lotSize: 120, strikeInterval: 25,  spanRate: "13.0", expiryMultiplier: "1.13" },
  SENSEX:     { exchange: "BFO", expiryCycle: "Weekly & Monthly", expiryDay: "Thursday",     lotSize: 20,  strikeInterval: 100, spanRate: "11.0", expiryMultiplier: "1.15" },
  BANKEX:     { exchange: "BFO", expiryCycle: "Monthly ONLY",     expiryDay: "Last Thursday",lotSize: 30,  strikeInterval: 100, spanRate: "12.0", expiryMultiplier: "1.14" },
};

const KNOWN_INDICES = Object.keys(INDEX_DEFAULTS).map(indexName => ({
  indexName,
  exchange: INDEX_DEFAULTS[indexName].exchange,
}));

const VALID_DAYS = [
  "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
  "Last Monday", "Last Tuesday", "Last Wednesday", "Last Thursday", "Last Friday", "Last Saturday",
] as const;

const VALID_CYCLES = ["Weekly & Monthly", "Monthly ONLY"] as const;

const updateSchema = z.object({
  exposureRate:     z.string().regex(/^\d+(\.\d+)?$/, "Must be a positive number"),
  spanRate:         z.string().regex(/^\d+(\.\d+)?$/, "Must be a positive number"),
  expiryMultiplier: z.string().regex(/^\d+(\.\d+)?$/, "Must be a positive number"),
  lotSize:          z.coerce.number().int().positive("Must be a positive integer"),
  expiryDay:        z.enum(VALID_DAYS, { errorMap: () => ({ message: "Must be a valid weekday or Last <weekday>" }) }),
  strikeInterval:   z.coerce.number().int().positive("Must be a positive integer"),
  expiryCycle:      z.enum(VALID_CYCLES, { errorMap: () => ({ message: "Must be 'Weekly & Monthly' or 'Monthly ONLY'" }) }),
});

export function registerIndexMarginRoutes(app: Express, storage: IStorage) {

  app.get("/api/index-margin-settings", async (_req, res) => {
    try {
      const marginRows = await storage.getAllIndexMarginSettings();
      const marginByName = new Map(marginRows.map(r => [r.indexName, r]));

      const seeded: string[] = [];
      const corrected: string[] = [];

      for (const [name, def] of Object.entries(INDEX_DEFAULTS)) {
        const existing = marginByName.get(name);

        if (!existing) {
          // Row doesn't exist — seed with correct defaults
          const row = await storage.upsertIndexMarginSetting({
            indexName:        name,
            exchange:         def.exchange,
            exposureRate:     "2.0",
            spanRate:         def.spanRate,
            expiryMultiplier: def.expiryMultiplier,
            lotSize:          def.lotSize,
            expiryDay:        def.expiryDay,
            strikeInterval:   def.strikeInterval,
            expiryCycle:      def.expiryCycle,
            updatedAt:        null,
          });
          marginByName.set(name, row);
          seeded.push(name);
        } else if (existing.lotSize === 1 || existing.expiryCycle == null) {
          // Row has placeholder lotSize=1 (never admin-edited) or missing expiryCycle
          // — correct it with canonical defaults without touching admin rate fields
          const row = await storage.upsertIndexMarginSetting({
            indexName:        name,
            exchange:         def.exchange,
            spanRate:         existing.spanRate === "10.0" ? def.spanRate : existing.spanRate,
            expiryMultiplier: existing.expiryMultiplier === "1.25" ? def.expiryMultiplier : existing.expiryMultiplier,
            exposureRate:     existing.exposureRate,
            lotSize:          def.lotSize,
            expiryDay:        def.expiryDay,
            strikeInterval:   def.strikeInterval,
            expiryCycle:      def.expiryCycle,
            updatedAt:        null,
          });
          marginByName.set(name, row);
          corrected.push(name);
        }
      }

      if (seeded.length > 0)    console.log(`[INDEX-MARGIN] Seeded: ${seeded.join(", ")}`);
      if (corrected.length > 0) console.log(`[INDEX-MARGIN] Corrected placeholder defaults: ${corrected.join(", ")}`);

      const result = KNOWN_INDICES.map(idx => marginByName.get(idx.indexName)!);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put("/api/index-margin-settings/:indexName", async (req, res) => {
    try {
      const { indexName } = req.params;
      const known = KNOWN_INDICES.find(i => i.indexName === indexName.toUpperCase());
      if (!known) {
        res.status(404).json({ error: `Unknown index: ${indexName}` });
        return;
      }
      const parsed = updateSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
        return;
      }
      const row = await storage.upsertIndexMarginSetting({
        indexName: known.indexName,
        exchange:  known.exchange,
        ...parsed.data,
        updatedAt: null,
      });
      res.json(row);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
}
