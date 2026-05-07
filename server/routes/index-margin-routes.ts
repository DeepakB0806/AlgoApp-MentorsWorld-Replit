import type { Express } from "express";
import type { IStorage } from "../storage";
import { z } from "zod";

const KNOWN_INDICES = [
  { indexName: "BANKEX",     exchange: "BFO" },
  { indexName: "BANKNIFTY",  exchange: "NFO" },
  { indexName: "FINNIFTY",   exchange: "NFO" },
  { indexName: "MIDCPNIFTY", exchange: "NFO" },
  { indexName: "NIFTY",      exchange: "NFO" },
  { indexName: "SENSEX",     exchange: "BFO" },
];

const VALID_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

const updateSchema = z.object({
  exposureRate:     z.string().regex(/^\d+(\.\d+)?$/, "Must be a positive number"),
  spanRate:         z.string().regex(/^\d+(\.\d+)?$/, "Must be a positive number"),
  expiryMultiplier: z.string().regex(/^\d+(\.\d+)?$/, "Must be a positive number"),
  lotSize:          z.coerce.number().int().positive("Must be a positive integer"),
  expiryDay:        z.enum(VALID_DAYS, { errorMap: () => ({ message: "Must be a valid weekday (Mon–Sat)" }) }),
  strikeInterval:   z.coerce.number().int().positive("Must be a positive integer"),
});

export function registerIndexMarginRoutes(app: Express, storage: IStorage) {

  app.get("/api/index-margin-settings", async (_req, res) => {
    try {
      const marginRows = await storage.getAllIndexMarginSettings();
      const marginByName = new Map(marginRows.map(r => [r.indexName, r]));

      const seeded: string[] = [];
      for (const idx of KNOWN_INDICES) {
        if (!marginByName.has(idx.indexName)) {
          const row = await storage.upsertIndexMarginSetting({
            indexName:        idx.indexName,
            exchange:         idx.exchange,
            exposureRate:     "2.0",
            spanRate:         "10.0",
            expiryMultiplier: "1.25",
            lotSize:          1,
            expiryDay:        "Thursday",
            strikeInterval:   50,
            updatedAt:        null,
          });
          marginByName.set(idx.indexName, row);
          seeded.push(idx.indexName);
        }
      }
      if (seeded.length > 0) {
        console.log(`[INDEX-MARGIN] Seeded defaults for: ${seeded.join(", ")}`);
      }

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
