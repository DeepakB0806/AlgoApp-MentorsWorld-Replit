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

const DAY_NAMES: Record<number, string> = {
  0: "Sunday", 1: "Monday", 2: "Tuesday", 3: "Wednesday",
  4: "Thursday", 5: "Friday", 6: "Saturday",
};

const updateSchema = z.object({
  exposureRate:     z.string().regex(/^\d+(\.\d+)?$/, "Must be a positive number"),
  spanRate:         z.string().regex(/^\d+(\.\d+)?$/, "Must be a positive number"),
  expiryMultiplier: z.string().regex(/^\d+(\.\d+)?$/, "Must be a positive number"),
});

export function registerIndexMarginRoutes(app: Express, storage: IStorage) {

  app.get("/api/index-margin-settings", async (_req, res) => {
    try {
      const [marginRows, expiryRows, instrumentRows] = await Promise.all([
        storage.getAllIndexMarginSettings(),
        storage.getIndexExpirySettings(),
        storage.getInstrumentConfigs(),
      ]);

      const marginByName = new Map(marginRows.map(r => [r.indexName, r]));
      const expiryByName = new Map(expiryRows.map(r => [r.indexName, r]));
      const lotByName    = new Map(instrumentRows.map(r => [r.ticker, r.lotSize]));

      const seeded: string[] = [];
      for (const idx of KNOWN_INDICES) {
        if (!marginByName.has(idx.indexName)) {
          const row = await storage.upsertIndexMarginSetting({
            indexName:        idx.indexName,
            exchange:         idx.exchange,
            exposureRate:     "2.0",
            spanRate:         "10.0",
            expiryMultiplier: "1.25",
            updatedAt:        null,
          });
          marginByName.set(idx.indexName, row);
          seeded.push(idx.indexName);
        }
      }
      if (seeded.length > 0) {
        console.log(`[INDEX-MARGIN] Seeded defaults for: ${seeded.join(", ")}`);
      }

      const result = KNOWN_INDICES.map(idx => {
        const m = marginByName.get(idx.indexName)!;
        const e = expiryByName.get(idx.indexName);
        const expiryDayName = e ? (DAY_NAMES[e.defaultExpiryDay] ?? String(e.defaultExpiryDay)) : null;
        const lotSize       = lotByName.get(idx.indexName) ?? null;
        return {
          ...m,
          expiryDay: expiryDayName,
          lotSize,
        };
      });

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
