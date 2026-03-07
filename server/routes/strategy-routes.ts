import type { Express } from "express";
import type { IStorage } from "../storage";
import { insertStrategySchema, insertStrategyConfigSchema, insertStrategyPlanSchema, PREDEFINED_INDICATORS } from "@shared/schema";
import { tradingCache } from "../cache";
import { requireSuperAdmin, requireTeamOrSuperAdmin } from "./helpers";

export function registerStrategyRoutes(app: Express, storage: IStorage) {
  app.get("/api/strategies", async (req, res) => {
    try {
      const strategies = await storage.getStrategies();
      res.json(strategies);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch strategies" });
    }
  });

  app.get("/api/strategies/:id", async (req, res) => {
    try {
      const strategy = await storage.getStrategy(req.params.id);
      if (!strategy) {
        return res.status(404).json({ error: "Strategy not found" });
      }
      res.json(strategy);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch strategy" });
    }
  });

  app.post("/api/strategies", async (req, res) => {
    try {
      const parsed = insertStrategySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid strategy data", details: parsed.error });
      }
      const strategy = await storage.createStrategy(parsed.data);
      res.status(201).json(strategy);
    } catch (error) {
      res.status(500).json({ error: "Failed to create strategy" });
    }
  });

  app.patch("/api/strategies/:id", async (req, res) => {
    try {
      const parsed = insertStrategySchema.partial().safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid strategy data", details: parsed.error });
      }
      const strategy = await storage.updateStrategy(req.params.id, parsed.data);
      if (!strategy) {
        return res.status(404).json({ error: "Strategy not found" });
      }
      res.json(strategy);
    } catch (error) {
      res.status(500).json({ error: "Failed to update strategy" });
    }
  });

  app.delete("/api/strategies/:id", async (req, res) => {
    try {
      const deleted = await storage.deleteStrategy(req.params.id);
      if (!deleted) {
        return res.status(404).json({ error: "Strategy not found" });
      }
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete strategy" });
    }
  });

  app.get("/api/strategy-configs", async (req: any, res) => {
    try {
      const user = requireTeamOrSuperAdmin(req, res);
      if (!user) return;
      const configs = await storage.getStrategyConfigs();
      res.json(configs);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch strategy configs" });
    }
  });

  app.get("/api/strategy-configs/:id", async (req: any, res) => {
    try {
      const user = requireTeamOrSuperAdmin(req, res);
      if (!user) return;
      const config = await storage.getStrategyConfig(req.params.id);
      if (!config) {
        return res.status(404).json({ error: "Strategy config not found" });
      }
      res.json(config);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch strategy config" });
    }
  });

  app.post("/api/strategy-configs", async (req: any, res) => {
    try {
      const user = requireSuperAdmin(req, res);
      if (!user) return;
      const parsed = insertStrategyConfigSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid strategy config data", details: parsed.error });
      }
      const config = await storage.createStrategyConfig({ ...parsed.data, createdBy: user.id });
      res.status(201).json(config);
    } catch (error) {
      res.status(500).json({ error: "Failed to create strategy config" });
    }
  });

  app.patch("/api/strategy-configs/:id", async (req: any, res) => {
    try {
      const user = requireSuperAdmin(req, res);
      if (!user) return;
      const parsed = insertStrategyConfigSchema.partial().safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid strategy config data", details: parsed.error });
      }
      const existing = await storage.getStrategyConfig(req.params.id);
      if (!existing) {
        return res.status(404).json({ error: "Strategy config not found" });
      }
      const updateData = { ...parsed.data, configVersion: (existing.configVersion || 1) + 1 };
      const config = await storage.updateStrategyConfig(req.params.id, updateData);
      if (!config) {
        return res.status(404).json({ error: "Strategy config not found" });
      }
      tradingCache.invalidateConfig(req.params.id);
      res.json(config);
    } catch (error) {
      res.status(500).json({ error: "Failed to update strategy config" });
    }
  });

  app.delete("/api/strategy-configs/:id", async (req: any, res) => {
    try {
      const user = requireSuperAdmin(req, res);
      if (!user) return;
      const deleted = await storage.deleteStrategyConfig(req.params.id);
      if (!deleted) {
        return res.status(404).json({ error: "Strategy config not found" });
      }
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete strategy config" });
    }
  });

  app.get("/api/predefined-indicators", (req, res) => {
    res.json(PREDEFINED_INDICATORS);
  });

  app.get("/api/strategy-plans", async (req: any, res) => {
    try {
      const user = requireTeamOrSuperAdmin(req, res);
      if (!user) return;
      const plans = await storage.getStrategyPlans();
      res.json(plans);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch strategy plans" });
    }
  });

  app.get("/api/strategy-plans/config/:configId", async (req: any, res) => {
    try {
      const user = requireTeamOrSuperAdmin(req, res);
      if (!user) return;
      const plans = await storage.getStrategyPlansByConfig(req.params.configId);
      res.json(plans);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch strategy plans" });
    }
  });

  app.get("/api/strategy-plans/:id", async (req: any, res) => {
    try {
      const user = requireTeamOrSuperAdmin(req, res);
      if (!user) return;
      const plan = await storage.getStrategyPlan(req.params.id);
      if (!plan) {
        return res.status(404).json({ error: "Strategy plan not found" });
      }
      res.json(plan);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch strategy plan" });
    }
  });

  app.post("/api/strategy-plans", async (req: any, res) => {
    try {
      const user = requireTeamOrSuperAdmin(req, res);
      if (!user) return;
      const parsed = insertStrategyPlanSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid strategy plan data", details: parsed.error });
      }
      const plan = await storage.createStrategyPlan({ ...parsed.data, createdBy: user.id });
      if (plan.configId) tradingCache.invalidatePlans(plan.configId);
      res.status(201).json(plan);
    } catch (error) {
      res.status(500).json({ error: "Failed to create strategy plan" });
    }
  });

  app.patch("/api/strategy-plans/:id", async (req: any, res) => {
    try {
      const user = requireTeamOrSuperAdmin(req, res);
      if (!user) return;
      const parsed = insertStrategyPlanSchema.partial().safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid strategy plan data", details: parsed.error });
      }
      const plan = await storage.updateStrategyPlan(req.params.id, parsed.data);
      if (!plan) {
        return res.status(404).json({ error: "Strategy plan not found" });
      }
      if (plan.configId) tradingCache.invalidatePlans(plan.configId);
      res.json(plan);
    } catch (error) {
      res.status(500).json({ error: "Failed to update strategy plan" });
    }
  });

  app.delete("/api/strategy-plans/:id", async (req: any, res) => {
    try {
      const user = requireTeamOrSuperAdmin(req, res);
      if (!user) return;
      const existing = await storage.getStrategyPlan(req.params.id);
      const deleted = await storage.deleteStrategyPlan(req.params.id);
      if (!deleted) {
        return res.status(404).json({ error: "Strategy plan not found" });
      }
      if (existing?.configId) tradingCache.invalidatePlans(existing.configId);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete strategy plan" });
    }
  });

  app.post("/api/strategy-configs/sync-receive", async (req, res) => {
    try {
      const syncKey = req.headers["x-sync-key"];
      if (syncKey !== process.env.SESSION_SECRET) {
        return res.status(403).json({ error: "Forbidden" });
      }
      const { configId, updates } = req.body;
      if (!configId || !updates) {
        return res.status(400).json({ error: "configId and updates required" });
      }
      const existing = await storage.getStrategyConfig(configId);
      if (!existing) {
        return res.status(404).json({ error: "Strategy config not found" });
      }
      const updateData = { ...updates, configVersion: (existing.configVersion || 1) + 1 };
      const config = await storage.updateStrategyConfig(configId, updateData);
      if (!config) {
        return res.status(500).json({ error: "Failed to update strategy config" });
      }
      tradingCache.invalidateConfig(configId);
      if (existing.webhookId) tradingCache.invalidateWebhook(existing.webhookId);
      res.json({ success: true, configId, configVersion: config.configVersion });
    } catch (error: any) {
      console.error("Strategy config sync-receive error:", error);
      res.status(500).json({ error: `Sync failed: ${error.message}` });
    }
  });

  app.post("/api/strategy-configs/sync-to-production", async (req: any, res) => {
    try {
      const user = requireSuperAdmin(req, res);
      if (!user) return;
      const { configId } = req.body;
      if (!configId) {
        return res.status(400).json({ error: "configId required" });
      }
      const config = await storage.getStrategyConfig(configId);
      if (!config) {
        return res.status(404).json({ error: "Strategy config not found in development" });
      }
      const domainSetting = await storage.getSetting("domain_name");
      if (!domainSetting || !domainSetting.value) {
        return res.status(400).json({ error: "Production domain not configured" });
      }
      const productionUrl = `https://${domainSetting.value}/api/strategy-configs/sync-receive`;
      const updates: Record<string, any> = {};
      if (config.actionMapper) updates.actionMapper = config.actionMapper;
      if (config.uptrendBlock) updates.uptrendBlock = config.uptrendBlock;
      if (config.downtrendBlock) updates.downtrendBlock = config.downtrendBlock;
      if (config.neutralBlock) updates.neutralBlock = config.neutralBlock;

      const response = await fetch(productionUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-sync-key": process.env.SESSION_SECRET || "",
        },
        body: JSON.stringify({ configId, updates }),
        signal: AbortSignal.timeout(30000),
      });
      if (!response.ok) {
        const errText = await response.text();
        return res.status(502).json({ error: `Production sync failed: ${response.status} ${errText}` });
      }
      const result = await response.json();
      res.json(result);
    } catch (error: any) {
      console.error("Strategy config sync-to-production error:", error);
      res.status(500).json({ error: `Sync failed: ${error.message}` });
    }
  });

  app.get("/api/instrument-configs", async (req, res) => {
    try {
      const configs = await storage.getInstrumentConfigs();
      res.json(configs);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch instrument configs" });
    }
  });

  app.get("/api/instrument-configs/:ticker", async (req, res) => {
    try {
      const exchange = (req.query.exchange as string) || "NFO";
      const config = await storage.getInstrumentConfig(req.params.ticker, exchange);
      if (!config) return res.status(404).json({ error: "Instrument config not found" });
      res.json(config);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch instrument config" });
    }
  });

  app.get("/api/instrument-configs/scrip-master-preview/:brokerId", async (req, res) => {
    try {
      const brokerConfig = await storage.getBrokerConfig(req.params.brokerId);
      if (!brokerConfig) return res.status(404).json({ error: "Broker config not found" });
      if (!brokerConfig.isConnected || !brokerConfig.accessToken) {
        return res.status(400).json({ error: "Broker not connected. Please login first." });
      }

      const { default: EL } = await import("../el-kotak-neo-v3");
      const filePathsResult = await EL.getScripMasterFilePaths(brokerConfig);
      if (!filePathsResult.success) {
        return res.status(502).json({ error: filePathsResult.error || "Failed to get file paths" });
      }

      const data = filePathsResult.data;
      let nfoFileUrl: string | null = null;

      if (Array.isArray(data)) {
        for (const item of data) {
          const path = item.filePath || item.path || item.url || item.fileUrl || "";
          const name = item.fileName || item.name || item.exchange || "";
          if (path && (name.toLowerCase().includes("nfo") || name.toLowerCase().includes("nse_fo") || path.toLowerCase().includes("nfo") || path.toLowerCase().includes("nse_fo"))) {
            nfoFileUrl = path;
            break;
          }
        }
        if (!nfoFileUrl && data.length > 0) {
          for (const item of data) {
            const path = item.filePath || item.path || item.url || item.fileUrl || "";
            if (path) { nfoFileUrl = path; break; }
          }
        }
      } else if (data && typeof data === 'object') {
        const filesPaths = data.filesPaths || data.data?.filesPaths;
        if (filesPaths && Array.isArray(filesPaths)) {
          for (const item of filesPaths) {
            const path = typeof item === 'string' ? item : (item.filePath || item.path || item.url || "");
            const name = typeof item === 'string' ? item : (item.fileName || item.name || item.exchange || "");
            if (path && (name.toLowerCase().includes("nfo") || name.toLowerCase().includes("nse_fo") || path.toLowerCase().includes("nfo") || path.toLowerCase().includes("nse_fo"))) {
              nfoFileUrl = path;
              break;
            }
          }
        }
      }

      if (!nfoFileUrl) {
        return res.status(404).json({ error: "Could not find NFO scrip master file URL in response" });
      }

      const csvResponse = await fetch(nfoFileUrl, { signal: AbortSignal.timeout(60000) });
      if (!csvResponse.ok) {
        return res.status(502).json({ error: `Download failed: ${csvResponse.status}` });
      }
      const csvText = await csvResponse.text();
      const lines = csvText.split('\n').filter((l: string) => l.trim());
      if (lines.length < 2) {
        return res.status(422).json({ error: "CSV has no data rows" });
      }

      const parseCSVLine = (line: string): string[] => {
        const result: string[] = [];
        let current = "";
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
          const ch = line[i];
          if (ch === '"') { inQuotes = !inQuotes; }
          else if (ch === ',' && !inQuotes) { result.push(current.trim()); current = ""; }
          else { current += ch; }
        }
        result.push(current.trim());
        return result;
      };

      const INDEX_TICKERS = ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "SENSEX", "BANKEX"];
      const csvHeaders = parseCSVLine(lines[0]);
      const headersLower = csvHeaders.map((h: string) => h.toLowerCase().replace(/[^a-z0-9_]/g, ''));

      const symbolIdx = headersLower.findIndex((h: string) => h === 'psymbolname' || h === 'symbolname' || h === 'symbol_name' || h === 'psymbol' || h === 'symbol' || h === 'tsym' || h === 'tradingsymbol' || h === 'psymname');
      const preferredLotNames = ['lotsize', 'lot_size', 'plotsize', 'llotsize', 'ilotsize'];
      const fallbackLotNames = ['brdlotqty', 'boardlotqty', 'pbrdlotqty', 'iboardlotqty'];
      let lotIdx = headersLower.findIndex((h: string) => preferredLotNames.includes(h));
      if (lotIdx < 0) lotIdx = headersLower.findIndex((h: string) => fallbackLotNames.includes(h));
      const instTypeIdx = headersLower.findIndex((h: string) => h === 'instrumenttype' || h === 'instrument_type' || h === 'insttype' || h === 'instype' || h === 'pinsttype' || h === 'pinstrumenttype');

      const rawRows: string[][] = [];
      const tickerLotSizes = new Map<string, Map<number, number>>();
      const MAX_RAW_ROWS = 200;

      for (let i = 1; i < lines.length; i++) {
        const cols = parseCSVLine(lines[i]);
        if (cols.length < 3) continue;

        const symbol = symbolIdx >= 0 ? cols[symbolIdx] : "";
        const instType = instTypeIdx >= 0 ? cols[instTypeIdx] : "";
        if (!instType.includes("OPT") && !instType.includes("FUT")) continue;

        let baseTicker = "";
        for (const idx of INDEX_TICKERS) {
          if (symbol.startsWith(idx)) { baseTicker = idx; break; }
        }
        if (!baseTicker) continue;

        if (rawRows.length < MAX_RAW_ROWS) {
          rawRows.push(cols.slice(0, csvHeaders.length));
        }

        const lotSizeStr = lotIdx >= 0 ? cols[lotIdx] : "";
        const lotSize = parseInt(lotSizeStr, 10);
        if (!isNaN(lotSize) && lotSize > 0) {
          if (!tickerLotSizes.has(baseTicker)) tickerLotSizes.set(baseTicker, new Map());
          const freq = tickerLotSizes.get(baseTicker)!;
          freq.set(lotSize, (freq.get(lotSize) || 0) + 1);
        }
      }

      const dbConfigs = await storage.getInstrumentConfigs();
      const dbConfigMap = new Map(dbConfigs.map(c => [c.ticker, c]));

      const lotSizeSummary: Array<{
        ticker: string;
        csvMode: number;
        csvCounts: Array<{ lotSize: number; count: number }>;
        dbLotSize: number | null;
        mismatch: boolean;
      }> = [];

      for (const [ticker, freqMap] of Array.from(tickerLotSizes.entries())) {
        const counts = Array.from(freqMap.entries())
          .map(([lotSize, count]) => ({ lotSize, count }))
          .sort((a, b) => b.count - a.count);
        const csvMode = counts.length > 0 ? counts[0].lotSize : 0;
        const dbConfig = dbConfigMap.get(ticker);
        const dbLotSize = dbConfig ? dbConfig.lotSize : null;
        lotSizeSummary.push({
          ticker,
          csvMode,
          csvCounts: counts,
          dbLotSize,
          mismatch: dbLotSize !== null && dbLotSize !== csvMode,
        });
      }

      lotSizeSummary.sort((a, b) => a.ticker.localeCompare(b.ticker));

      res.json({
        headers: csvHeaders,
        lotColumnName: lotIdx >= 0 ? csvHeaders[lotIdx] : null,
        lotColumnIndex: lotIdx,
        totalCsvLines: lines.length - 1,
        filteredRows: rawRows.length,
        rawRows,
        lotSizeSummary,
      });
    } catch (error: any) {
      console.error("Scrip master preview error:", error);
      res.status(500).json({ error: error.message || "Failed to generate preview" });
    }
  });

  app.post("/api/instrument-configs/sync", async (req, res) => {
    try {
      const { brokerConfigId } = req.body;
      if (!brokerConfigId) return res.status(400).json({ error: "brokerConfigId is required" });

      const brokerConfig = await storage.getBrokerConfig(brokerConfigId);
      if (!brokerConfig) return res.status(404).json({ error: "Broker config not found" });
      if (!brokerConfig.isConnected || !brokerConfig.accessToken) {
        return res.status(400).json({ error: "Broker not connected. Please login first." });
      }

      const { runScripMasterSync } = await import("../scrip-master-sync");
      const result = await runScripMasterSync(storage, brokerConfig);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: `Sync failed: ${error.message}` });
    }
  });
}
