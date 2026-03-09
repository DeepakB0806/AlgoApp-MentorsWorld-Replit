import type { Express } from "express";
import type { IStorage } from "../storage";
import { insertWebhookSchema } from "@shared/schema";
import { tradingCache } from "../cache";
import { resolveSignalFromActionMapper, resolveAllSignalsFromActionMapper, processTradeSignal } from "../te-kotak-neo-v3";
import { getBaseUrlFromRequest } from "../services/email";
import { parseNumeric } from "./helpers";

export function registerWebhookRoutes(app: Express, storage: IStorage) {
  app.get("/api/webhooks", async (req, res) => {
    try {
      const webhooks = await storage.getWebhooks();
      res.json(webhooks);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch webhooks" });
    }
  });

  app.get("/api/webhooks/default-fields", async (req, res) => {
    const defaultFields = [
      { name: "Time Unix", key: "time_unix", type: "timestamp", order: 0 },
      { name: "Exchange", key: "exchange", type: "text", order: 1 },
      { name: "Ticker (Indices)", key: "indices", type: "text", order: 2 },
      { name: "Indicator", key: "indicator", type: "text", order: 3 },
      { name: "Action (Alert)", key: "alert", type: "text", order: 4 },
      { name: "Price", key: "price", type: "number", order: 5 },
      { name: "Local Time", key: "local_time", type: "text", order: 6 },
      { name: "Mode", key: "mode", type: "text", order: 7 },
      { name: "Mode Desc", key: "mode_desc", type: "text", order: 8 },
      { name: "Fast Line", key: "first_line", type: "number", order: 9 },
      { name: "Mid Line", key: "mid_line", type: "number", order: 10 },
      { name: "Slow Line", key: "slow_line", type: "number", order: 11 },
      { name: "Supertrend (ST)", key: "st", type: "number", order: 12 },
      { name: "Half Trend (HT)", key: "ht", type: "number", order: 13 },
      { name: "RSI", key: "rsi", type: "number", order: 14 },
      { name: "RSI Scaled", key: "rsi_scaled", type: "number", order: 15 },
      { name: "Alert System", key: "alert_system", type: "text", order: 16 },
      { name: "Action Binary", key: "action_binary", type: "number", order: 17 },
      { name: "Lock State", key: "lock_state", type: "text", order: 18 }
    ];
    res.json(defaultFields);
  });

  app.get("/api/webhooks/:id", async (req, res) => {
    try {
      const webhook = await storage.getWebhook(req.params.id);
      if (!webhook) {
        return res.status(404).json({ error: "Webhook not found" });
      }
      res.json(webhook);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch webhook" });
    }
  });

  app.get("/api/webhooks/:id/inbound-links", async (req, res) => {
    try {
      const inboundLinks = await storage.getWebhooksLinkingTo(req.params.id);
      res.json(inboundLinks);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch inbound links" });
    }
  });

  app.post("/api/webhooks", async (req, res) => {
    try {
      const parsed = insertWebhookSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid webhook data", details: parsed.error });
      }
      
      const webhook = await storage.createWebhook(parsed.data);
      
      const requestBaseUrl = getBaseUrlFromRequest(req);
      let generatedUrl: string;
      
      if (requestBaseUrl && requestBaseUrl.startsWith("http")) {
        generatedUrl = `${requestBaseUrl}/api/webhook/${webhook.id}`;
      } else {
        const domainSetting = await storage.getSetting("domain_name");
        generatedUrl = domainSetting?.value 
          ? `https://${domainSetting.value}/api/webhook/${webhook.id}`
          : `/api/webhook/${webhook.id}`;
      }
      
      const updatedWebhook = await storage.updateWebhook(webhook.id, { webhookUrl: generatedUrl });
      res.status(201).json(updatedWebhook || webhook);
    } catch (error) {
      res.status(500).json({ error: "Failed to create webhook" });
    }
  });

  app.patch("/api/webhooks/:id", async (req, res) => {
    try {
      const parsed = insertWebhookSchema.partial().safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid webhook data", details: parsed.error });
      }
      const webhook = await storage.updateWebhook(req.params.id, parsed.data);
      if (!webhook) {
        return res.status(404).json({ error: "Webhook not found" });
      }
      res.json(webhook);
    } catch (error) {
      res.status(500).json({ error: "Failed to update webhook" });
    }
  });

  app.delete("/api/webhooks/:id", async (req, res) => {
    try {
      const deleted = await storage.deleteWebhook(req.params.id);
      if (!deleted) {
        return res.status(404).json({ error: "Webhook not found" });
      }
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete webhook" });
    }
  });

  app.post("/api/webhooks/:id/configure-fields", async (req, res) => {
    try {
      const { fields } = req.body;
      
      if (!fields || !Array.isArray(fields)) {
        return res.status(400).json({ error: "Fields array is required" });
      }
      
      const fieldConfig = fields.map((name: string, index: number) => ({
        name: name.trim(),
        key: name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''),
        type: 'text' as const,
        order: index
      }));
      
      const webhook = await storage.updateWebhook(req.params.id, {
        fieldConfig: JSON.stringify(fieldConfig)
      });
      
      if (!webhook) {
        return res.status(404).json({ error: "Webhook not found" });
      }
      
      res.json({ success: true, fieldConfig, webhook });
    } catch (error) {
      console.error("Error configuring webhook fields:", error);
      res.status(500).json({ error: "Failed to configure webhook fields" });
    }
  });

  app.get("/api/webhook-registry", async (req, res) => {
    try {
      const registry = await storage.getWebhookRegistry();
      res.json(registry);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch webhook registry" });
    }
  });

  app.get("/api/webhook-registry/:code", async (req, res) => {
    try {
      const entry = await storage.getWebhookRegistryEntry(req.params.code);
      if (!entry) {
        return res.status(404).json({ error: "Webhook code not found in registry" });
      }
      res.json(entry);
    } catch (error) {
      res.status(500).json({ error: "Failed to lookup webhook code" });
    }
  });

  app.post("/api/webhook-registry/sync", async (req, res) => {
    try {
      const domainSetting = await storage.getSetting("domain_name");
      if (!domainSetting || !domainSetting.value) {
        return res.status(400).json({ error: "Production domain not configured. Please set domain name in settings." });
      }
      
      const productionUrl = `https://${domainSetting.value}/api/webhook-registry`;
      
      const response = await fetch(productionUrl, {
        headers: { "Accept": "application/json" },
        signal: AbortSignal.timeout(10000),
      });
      
      if (!response.ok) {
        return res.status(502).json({ error: `Failed to fetch from production: ${response.status} ${response.statusText}` });
      }
      
      const productionRegistry = await response.json() as any[];
      
      let synced = 0;
      let skipped = 0;
      
      for (const entry of productionRegistry) {
        const existing = await storage.getWebhookRegistryEntry(entry.uniqueCode || entry.unique_code);
        if (!existing) {
          await storage.createWebhookRegistryEntry({
            uniqueCode: entry.uniqueCode || entry.unique_code,
            webhookId: entry.webhookId || entry.webhook_id,
            webhookName: entry.webhookName || entry.webhook_name,
            createdBy: entry.createdBy || entry.created_by || "production-sync",
            isActive: entry.isActive ?? entry.is_active ?? true,
            notes: `Synced from production on ${new Date().toISOString()}`,
          });
          synced++;
        } else {
          skipped++;
        }
      }
      
      res.json({ 
        success: true, 
        synced, 
        skipped, 
        total: productionRegistry.length,
        message: `Synced ${synced} new webhooks from production (${skipped} already existed)` 
      });
    } catch (error: any) {
      console.error("Sync error:", error);
      res.status(500).json({ error: error.message || "Failed to sync webhook registry" });
    }
  });

  app.post("/api/webhook/:id", async (req, res) => {
    const t0 = Date.now();
    const webhookId = req.params.id;
    const timing: Record<string, number> = {};
    
    try {
      let webhook = tradingCache.getWebhook(webhookId);
      if (!webhook) {
        webhook = await storage.getWebhook(webhookId) || undefined;
        if (webhook) tradingCache.setWebhook(webhookId, webhook);
      }
      timing.webhook_lookup_ms = Date.now() - t0;

      if (!webhook) return res.status(404).json({ error: "Webhook not found" });
      if (!webhook.isActive) return res.status(403).json({ error: "Webhook is disabled" });

      const providedSecret = req.headers["x-secret-key"] || req.query.secret;
      if (webhook.secretKey && providedSecret !== webhook.secretKey) {
        return res.status(401).json({ error: "Invalid secret key" });
      }

      const payload = req.body;
      const t1 = Date.now();

      const parsedData = {
        timeUnix: parseNumeric(payload.TimeStamp ?? payload.time_unix ?? payload.timeUnix ?? payload.TIME_UNIX ?? payload.Time_Unix ?? payload.timestamp ?? payload.TIMESTAMP ?? payload.Timestamp),
        exchange: payload.exchange || payload.EXCHANGE || payload.Exchange,
        indices: payload.indices || payload.INDICES || payload.Indices || payload.ticker || payload.TICKER || payload.Ticker,
        indicator: payload.indicator || payload.INDICATOR || payload.Indicator,
        alert: payload.alert || payload.ALERT || payload.Alert || payload.action || payload.ACTION || payload.Action,
        price: parseNumeric(payload.price ?? payload.PRICE ?? payload.Price),
        localTime: payload.LocalTime || payload.local_time || payload.localTime || payload.LOCAL_TIME || payload.Local_Time,
        mode: payload.mode || payload.MODE || payload.Mode,
        modeDesc: payload.Mode_Description || payload.mode_desc || payload.modeDesc || payload.MODE_DESC || payload.Mode_Desc || payload["Mode Description"],
        firstLine: parseNumeric(payload.Fast_Line ?? payload.first_line ?? payload.fast_line ?? payload.FIRST_LINE ?? payload.FAST_LINE ?? payload.First_Line ?? payload.firstLine ?? payload.fastLine ?? payload["Fast Line"]),
        midLine: parseNumeric(payload.Mid_Line ?? payload.mid_line ?? payload.MID_LINE ?? payload.midLine ?? payload["Mid Line"]),
        slowLine: parseNumeric(payload.Slow_Line ?? payload.slow_line ?? payload.SLOW_LINE ?? payload.slowLine ?? payload["Slow Line"]),
        st: parseNumeric(payload.SuperTrend_ST ?? payload.st ?? payload.ST ?? payload.St ?? payload.supertrend ?? payload.SUPERTREND ?? payload.Supertrend ?? payload.Super_Trend ?? payload["SuperTrend ST"]),
        ht: parseNumeric(payload.Half_Trend_HT ?? payload.ht ?? payload.HT ?? payload.Ht ?? payload.halftrend ?? payload.HALFTREND ?? payload.Halftrend ?? payload.half_trend ?? payload.HALF_TREND ?? payload.Half_Trend ?? payload["Half Trend HT"]),
        rsi: parseNumeric(payload.rsi ?? payload.RSI ?? payload.Rsi),
        rsiScaled: parseNumeric(payload.RSI_Scaled ?? payload.rsi_scaled ?? payload.RSI_SCALED ?? payload.Rsi_Scaled ?? payload.rsiScaled ?? payload["RSI Scaled"]),
        alertSystem: payload.alert_system || payload.alertSystem || payload.ALERT_SYSTEM || payload.Alert_System,
        actionBinary: parseNumeric(payload.action_binary ?? payload.ACTION_BINARY ?? payload.Action_Binary ?? payload.actionBinary ?? payload.action_type ?? payload.ACTION_TYPE ?? payload.Action_Type),
        lockState: payload["Lock State"] || payload.lock_state || payload.lockState || payload.LOCK_STATE || payload.Lock_State,
      };
      timing.parse_ms = Date.now() - t1;

      const t2 = Date.now();
      let linkedConfig = tradingCache.getConfigByWebhookId(webhookId);
      if (linkedConfig === undefined) {
        linkedConfig = (await storage.getStrategyConfigByWebhookId(webhookId)) || null;
        tradingCache.setConfigByWebhookId(webhookId, linkedConfig);
      }

      const allSignals = resolveAllSignalsFromActionMapper(parsedData, linkedConfig?.actionMapper);
      const { signalType, blockType: directBlockType, resolvedAction } = allSignals[0];
      console.log(`[PFL] ▶ Webhook ${webhookId.slice(0,8)} received: alert=${parsedData.alert} signals=${allSignals.length} → ${allSignals.map(s => `${s.resolvedAction}@${s.blockType}(${s.signalType})`).join(", ")}`);
      timing.signal_resolve_ms = Date.now() - t2;

      const t3 = Date.now();
      let tradeResults: any[] = [];
      const strategyConfigId = linkedConfig?.id || webhook.strategyId || null;

      if (strategyConfigId && allSignals.some(s => s.signalType === "buy" || s.signalType === "sell")) {
        for (const signal of allSignals) {
          if (signal.signalType !== "buy" && signal.signalType !== "sell") continue;

          const webhookDataForTrade = {
            id: "",
            webhookId,
            strategyId: webhook.strategyId || null,
            webhookName: webhook.name,
            receivedAt: new Date().toISOString(),
            rawPayload: JSON.stringify(payload),
            ...parsedData,
            signalType: signal.signalType,
            isProcessed: false,
            processedAt: null,
          };

          try {
            const results = await processTradeSignal(storage, webhookDataForTrade as any, strategyConfigId, {
              blockType: signal.blockType,
              resolvedAction: signal.resolvedAction,
              parentExchange: linkedConfig?.exchange,
              parentTicker: linkedConfig?.ticker,
            });
            tradeResults.push(...results);
          } catch (ptError) {
            console.error(`Trade execution error for ${signal.resolvedAction}@${signal.blockType}:`, ptError);
            tradeResults.push({ success: false, action: "error", message: String(ptError) });
          }
        }

        if (allSignals.length > 1) {
          console.log(`[PFL] Composite signal: ${allSignals.length} actions processed — ${allSignals.map(s => `${s.resolvedAction}@${s.blockType}`).join(", ")}`);
        }
      }
      timing.trade_execute_ms = Date.now() - t3;
      console.log(`[PFL] ◀ Webhook ${webhookId.slice(0,8)} complete: ${tradeResults.length} result(s) — ${tradeResults.map(r => `${r.action}:${r.success?"OK":"FAIL"}`).join(", ")} | hot=${timing.total_hot_path_ms || (Date.now() - t0)}ms`);
      timing.total_hot_path_ms = Date.now() - t0;

      res.json({ 
        success: true, 
        message: "Webhook processed successfully",
        action: parsedData.actionBinary === 1 ? "BUY" : parsedData.actionBinary === 0 ? "SELL" : "UNKNOWN",
        signal: signalType,
        trades: tradeResults.length > 0 ? tradeResults : undefined,
        timing,
      });

      const ipAddress = (req.headers["x-forwarded-for"] as string)?.split(",")[0] || req.socket.remoteAddress || null;
      const userAgent = req.headers["user-agent"] || null;

      setImmediate(async () => {
        try {
          const coldStart = Date.now();

          await Promise.all([
            storage.createWebhookLog({
              webhookId,
              timestamp: new Date().toISOString(),
              payload: JSON.stringify(payload),
              status: "success",
              response: "Alert received and processed",
              executionTime: timing.total_hot_path_ms,
              ipAddress,
              userAgent,
              ...parsedData,
            }),

            storage.createWebhookData({
              webhookId,
              strategyId: webhook.strategyId || undefined,
              webhookName: webhook.name,
              receivedAt: new Date().toISOString(),
              rawPayload: JSON.stringify(payload),
              ...parsedData,
              signalType,
              isProcessed: tradeResults.some(r => r.success),
            }),

            storage.updateWebhook(webhookId, {
              lastTriggered: new Date().toISOString(),
              totalTriggers: (webhook.totalTriggers || 0) + 1,
            }),
          ]);

          tradingCache.invalidateWebhook(webhookId);

          console.log(`[WEBHOOK ${webhookId}] HOT: ${timing.total_hot_path_ms}ms | COLD: ${Date.now() - coldStart}ms | Signal: ${signalType} | Trades: ${tradeResults.length} | Timing: ${JSON.stringify(timing)}`);
        } catch (coldErr) {
          console.error("Cold path error (non-blocking):", coldErr);
        }
      });

    } catch (error) {
      console.error("Webhook processing error:", error);
      timing.total_ms = Date.now() - t0;
      
      setImmediate(async () => {
        try {
          await storage.createWebhookLog({
            webhookId,
            timestamp: new Date().toISOString(),
            payload: JSON.stringify(req.body),
            status: "failed",
            response: String(error),
            executionTime: timing.total_ms,
          });
        } catch (logErr) {
          console.error("Failed to log webhook error:", logErr);
        }
      });

      res.status(500).json({ error: "Webhook processing failed", timing });
    }
  });

  app.get("/api/webhooks/:id/status-logs", async (req, res) => {
    try {
      const logs = await storage.getWebhookStatusLogs(req.params.id);
      res.json(logs);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch status logs" });
    }
  });

  app.get("/api/webhooks/:id/stats", async (req, res) => {
    try {
      const stats = await storage.getWebhookLogStats(req.params.id);
      res.json(stats);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch webhook stats" });
    }
  });

  app.delete("/api/webhooks/:id/logs/cleanup", async (req, res) => {
    try {
      const daysToKeep = parseInt(req.query.days as string) || 30;
      const deletedCount = await storage.deleteOldWebhookLogs(req.params.id, daysToKeep);
      res.json({ success: true, deletedCount, daysToKeep });
    } catch (error) {
      res.status(500).json({ error: "Failed to cleanup logs" });
    }
  });

  app.delete("/api/webhooks/:id/logs/clear-all", async (req, res) => {
    try {
      const deletedCount = await storage.deleteAllWebhookLogs(req.params.id);
      res.json({ success: true, deletedCount });
    } catch (error) {
      res.status(500).json({ error: "Failed to clear all logs" });
    }
  });

  app.get("/api/webhook-data", async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 50;
      const data = await storage.getWebhookData(limit);
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch webhook data" });
    }
  });

  app.get("/api/webhook-data/webhook/:webhookId", async (req, res) => {
    try {
      const webhookId = req.params.webhookId;
      
      const webhook = await storage.getWebhook(webhookId);
      const effectiveWebhookId = webhook?.linkedWebhookId || webhookId;
      
      if (webhook?.linkedWebhookId) {
        const domainSetting = await storage.getSetting('domain_name');
        const domainName = domainSetting?.value;
        
        if (domainName) {
          try {
            const productionResponse = await fetch(
              `https://${domainName}/api/webhook-data/webhook/${effectiveWebhookId}`
            );
            if (productionResponse.ok) {
              const productionData = await productionResponse.json();
              return res.json(productionData);
            }
          } catch (fetchError) {
            console.log("Failed to fetch from production, falling back to local:", fetchError);
          }
        }
      }
      
      const data = await storage.getWebhookDataByWebhook(effectiveWebhookId);
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch webhook data" });
    }
  });

  app.post("/api/process-production-signals/:webhookId", async (req, res) => {
    try {
      const webhookId = req.params.webhookId;
      const webhook = await storage.getWebhook(webhookId);
      if (!webhook || !webhook.linkedWebhookId) {
        return res.json({ processed: 0, message: "No linked production webhook" });
      }

      const domainSetting = await storage.getSetting('domain_name');
      const domainName = domainSetting?.value;
      if (!domainName) {
        return res.json({ processed: 0, message: "No production domain configured" });
      }

      let productionData: any[] = [];
      try {
        const prodResp = await fetch(`https://${domainName}/api/webhook-data/webhook/${webhook.linkedWebhookId}`);
        if (prodResp.ok) {
          productionData = await prodResp.json();
        }
      } catch (fetchErr) {
        return res.json({ processed: 0, message: "Could not fetch production data" });
      }

      if (!productionData.length) {
        return res.json({ processed: 0, message: "No production signals found" });
      }

      const localData = await storage.getWebhookDataByWebhook(webhookId);
      const processedProdIds = new Set<string>();
      localData.forEach((d: any) => {
        try {
          const raw = JSON.parse(d.rawPayload || "{}");
          if (raw._prodSourceId) processedProdIds.add(String(raw._prodSourceId));
        } catch {}
        processedProdIds.add(`${d.timeUnix || 0}_${d.price || 0}_${d.alert || ""}`);
      });

      const strategyConfig = await storage.getStrategyConfigByWebhookId(webhookId);
      if (!strategyConfig) {
        return res.json({ processed: 0, message: "No strategy config linked to this webhook" });
      }

      const newSignals = productionData
        .filter((pd: any) => {
          if (pd.id && processedProdIds.has(String(pd.id))) return false;
          const fallbackKey = `${pd.timeUnix || 0}_${pd.price || 0}_${pd.alert || ""}`;
          if (processedProdIds.has(fallbackKey)) return false;
          return true;
        })
        .sort((a: any, b: any) => {
          const timeA = a.timeUnix || 0;
          const timeB = b.timeUnix || 0;
          if (timeA !== timeB) return timeA - timeB;
          const dateA = a.receivedAt ? new Date(a.receivedAt).getTime() : 0;
          const dateB = b.receivedAt ? new Date(b.receivedAt).getTime() : 0;
          return dateA - dateB;
        });

      if (!newSignals.length) {
        return res.json({ processed: 0, message: "All production signals already processed" });
      }

      const results: any[] = [];

      for (const signal of newSignals) {
        const allResolvedSignals = resolveAllSignalsFromActionMapper(signal, strategyConfig.actionMapper);
        const tradableSignals = allResolvedSignals.filter(s => s.signalType === "buy" || s.signalType === "sell");
        if (tradableSignals.length === 0) continue;

        let enrichedPayload = signal.rawPayload || "{}";
        if (signal.id) {
          try {
            const parsed = JSON.parse(enrichedPayload);
            parsed._prodSourceId = signal.id;
            enrichedPayload = JSON.stringify(parsed);
          } catch {}
        }

        for (const resolvedSignal of tradableSignals) {
          const localEntry = await storage.createWebhookData({
            webhookId,
            strategyId: strategyConfig.id,
            webhookName: webhook.name,
            receivedAt: signal.receivedAt || new Date().toISOString(),
            rawPayload: enrichedPayload,
            timeUnix: signal.timeUnix,
            exchange: signal.exchange,
            indices: signal.indices,
            indicator: signal.indicator,
            alert: signal.alert,
            price: signal.price,
            localTime: signal.localTime,
            mode: signal.mode,
            modeDesc: signal.modeDesc,
            firstLine: signal.firstLine,
            midLine: signal.midLine,
            slowLine: signal.slowLine,
            st: signal.st,
            ht: signal.ht,
            rsi: signal.rsi,
            rsiScaled: signal.rsiScaled,
            alertSystem: signal.alertSystem,
            actionBinary: signal.actionBinary,
            lockState: signal.lockState,
            signalType: resolvedSignal.signalType,
            isProcessed: false,
          });

          try {
            const tradeResults = await processTradeSignal(storage, localEntry, strategyConfig.id, { blockType: resolvedSignal.blockType, resolvedAction: resolvedSignal.resolvedAction, parentExchange: strategyConfig.exchange, parentTicker: strategyConfig.ticker });
            results.push({ signal: resolvedSignal.signalType, blockType: resolvedSignal.blockType, price: signal.price, time: signal.localTime, trades: tradeResults });
          } catch (ptErr) {
            console.error(`Trade execution error for ${resolvedSignal.resolvedAction}@${resolvedSignal.blockType}:`, ptErr);
            results.push({ signal: resolvedSignal.signalType, price: signal.price, error: String(ptErr) });
          }
        }
      }

      res.json({ processed: results.length, results });
    } catch (error: any) {
      console.error("Process production signals error:", error);
      res.status(500).json({ error: error.message || "Failed to process production signals" });
    }
  });

  app.post("/api/webhooks/:id/link", async (req, res) => {
    try {
      let { uniqueCode, webhookId } = req.body;
      
      if (!uniqueCode && !webhookId) {
        return res.status(400).json({ error: "Either uniqueCode or webhookId is required" });
      }
      
      if (uniqueCode && (uniqueCode.startsWith("D-") || uniqueCode.startsWith("P-"))) {
        uniqueCode = uniqueCode.substring(2);
      }
      
      let linkedId: string;
      let productionWebhook = null;
      let registryEntry = null;
      
      if (webhookId) {
        linkedId = webhookId;
        productionWebhook = await storage.getWebhook(webhookId);
      } else {
        productionWebhook = await storage.getWebhookByUniqueCode(uniqueCode);
        
        if (productionWebhook) {
          linkedId = productionWebhook.id;
        } else {
          registryEntry = await storage.getWebhookRegistryEntry(uniqueCode);
          if (registryEntry && registryEntry.webhookId) {
            linkedId = registryEntry.webhookId;
          } else {
            return res.status(404).json({ 
              error: "No webhook found with that code. Try syncing from production first, or use the webhook ID directly.",
              hint: "Click 'Sync from Production' to fetch the latest webhook codes."
            });
          }
        }
      }
      
      const devWebhook = await storage.getWebhook(req.params.id);
      if (!devWebhook) {
        return res.status(404).json({ error: "Webhook not found" });
      }
      
      const webhook = await storage.updateWebhook(req.params.id, { linkedWebhookId: linkedId });
      if (!webhook) {
        return res.status(404).json({ error: "Webhook not found" });
      }
      
      const domainSetting = await storage.getSetting('domain_name');
      if (domainSetting?.value) {
        try {
          const productionUrl = `https://${domainSetting.value}/api/webhooks/${linkedId}/register-link`;
          await fetch(productionUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ devWebhookCode: devWebhook.uniqueCode }),
          });
        } catch (err) {
          console.log("Could not register link on production (non-blocking):", err);
        }
      }
      
      res.json({ success: true, webhook, linkedWebhook: productionWebhook, registryEntry });
    } catch (error) {
      res.status(500).json({ error: "Failed to link webhook" });
    }
  });

  app.delete("/api/webhooks/:id/link", async (req, res) => {
    try {
      const existingWebhook = await storage.getWebhook(req.params.id);
      if (!existingWebhook) {
        return res.status(404).json({ error: "Webhook not found" });
      }
      
      const linkedId = existingWebhook.linkedWebhookId;
      const devCode = existingWebhook.uniqueCode;
      
      const webhook = await storage.updateWebhook(req.params.id, { linkedWebhookId: null });
      
      if (linkedId) {
        const domainSetting = await storage.getSetting('domain_name');
        if (domainSetting?.value) {
          try {
            const productionUrl = `https://${domainSetting.value}/api/webhooks/${linkedId}/unregister-link`;
            await fetch(productionUrl, {
              method: 'DELETE',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ devWebhookCode: devCode }),
            });
          } catch (err) {
            console.log("Could not unregister link on production (non-blocking):", err);
          }
        }
      }
      
      res.json({ success: true, webhook });
    } catch (error) {
      res.status(500).json({ error: "Failed to unlink webhook" });
    }
  });

  app.post("/api/webhooks/:id/register-link", async (req, res) => {
    try {
      const { devWebhookCode } = req.body;
      
      if (!devWebhookCode) {
        return res.status(400).json({ error: "devWebhookCode is required" });
      }
      
      const webhook = await storage.getWebhook(req.params.id);
      if (!webhook) {
        return res.status(404).json({ error: "Webhook not found" });
      }
      
      const linkedByWebhooks = webhook.linkedByWebhooks || [];
      
      if (!linkedByWebhooks.includes(devWebhookCode)) {
        linkedByWebhooks.push(devWebhookCode);
        await storage.updateWebhook(req.params.id, { linkedByWebhooks });
      }
      
      res.json({ success: true, linkedByWebhooks });
    } catch (error) {
      console.error("Failed to register link:", error);
      res.status(500).json({ error: "Failed to register link" });
    }
  });

  app.delete("/api/webhooks/:id/unregister-link", async (req, res) => {
    try {
      const { devWebhookCode } = req.body;
      
      if (!devWebhookCode) {
        return res.status(400).json({ error: "devWebhookCode is required" });
      }
      
      const webhook = await storage.getWebhook(req.params.id);
      if (!webhook) {
        return res.status(404).json({ error: "Webhook not found" });
      }
      
      const linkedByWebhooks = (webhook.linkedByWebhooks || []).filter(
        (code: string) => code !== devWebhookCode
      );
      
      await storage.updateWebhook(req.params.id, { linkedByWebhooks });
      
      res.json({ success: true, linkedByWebhooks });
    } catch (error) {
      console.error("Failed to unregister link:", error);
      res.status(500).json({ error: "Failed to unregister link" });
    }
  });

  app.get("/api/webhook-data/strategy/:strategyId", async (req, res) => {
    try {
      const data = await storage.getWebhookDataByStrategy(req.params.strategyId);
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch webhook data" });
    }
  });

  app.get("/api/webhook-data/webhook/:webhookId/latest", async (req, res) => {
    try {
      const data = await storage.getLatestWebhookData(req.params.webhookId);
      if (!data) {
        return res.status(404).json({ error: "No data found for this webhook" });
      }
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch webhook data" });
    }
  });

  app.patch("/api/webhook-data/:id/processed", async (req, res) => {
    try {
      const data = await storage.markWebhookDataProcessed(req.params.id);
      if (!data) {
        return res.status(404).json({ error: "Webhook data not found" });
      }
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: "Failed to update webhook data" });
    }
  });

  app.delete("/api/webhook-data/webhook/:webhookId/cleanup", async (req, res) => {
    try {
      const daysToKeep = parseInt(req.query.days as string) || 30;
      const deletedCount = await storage.deleteWebhookData(req.params.webhookId, daysToKeep);
      res.json({ success: true, deletedCount, daysToKeep });
    } catch (error) {
      res.status(500).json({ error: "Failed to cleanup webhook data" });
    }
  });

  app.delete("/api/webhook-data/cleanup", async (req, res) => {
    try {
      const daysToKeep = parseInt(req.query.days as string) || 30;
      const deletedCount = await storage.deleteWebhookDataOlderThan(daysToKeep);
      res.json({ success: true, deletedCount, daysToKeep });
    } catch (error) {
      res.status(500).json({ error: "Failed to cleanup webhook data" });
    }
  });

  app.delete("/api/webhook-data/cleanup-all", async (req, res) => {
    try {
      const deletedCount = await storage.deleteAllWebhookData();
      res.json({ success: true, deletedCount });
    } catch (error) {
      res.status(500).json({ error: "Failed to cleanup all webhook data" });
    }
  });

  app.post("/api/webhooks/:id/test", async (req, res) => {
    const startTime = Date.now();
    const webhookId = req.params.id;
    
    try {
      const webhook = await storage.getWebhook(webhookId);
      if (!webhook) {
        return res.status(404).json({ error: "Webhook not found" });
      }

      const testPayload = {
        time_unix: Math.floor(Date.now() / 1000),
        exchange: "NSE",
        indices: "NIFTY50",
        indicator: "Test Indicator",
        alert: "Test Alert",
        price: 19500.50,
        local_time: new Date().toLocaleString(),
        mode: "test",
        mode_desc: "Test mode",
        action_binary: 1,
        lock_state: "unlocked",
      };

      const responseTime = Date.now() - startTime;
      
      await storage.createWebhookStatusLog({
        webhookId,
        testPayload: JSON.stringify(testPayload),
        status: "success",
        statusCode: 200,
        responseMessage: "Test webhook executed successfully",
        responseTime,
        testedAt: new Date().toISOString(),
      });

      res.json({ 
        success: true, 
        message: "Test webhook sent successfully",
        testPayload,
        responseTime,
      });
    } catch (error) {
      console.error("Test webhook error:", error);
      const responseTime = Date.now() - startTime;
      
      await storage.createWebhookStatusLog({
        webhookId,
        testPayload: JSON.stringify(req.body || {}),
        status: "failed",
        statusCode: 500,
        responseMessage: "Test failed",
        errorMessage: String(error),
        responseTime,
        testedAt: new Date().toISOString(),
      });

      res.status(500).json({ error: "Test webhook failed" });
    }
  });

  app.get("/api/webhook-signals/:webhookId", async (req, res) => {
    try {
      const webhookId = req.params.webhookId;
      const fieldKeys = new Set<string>();

      const webhook = await storage.getWebhook(webhookId);
      if (webhook && webhook.fieldConfig) {
        try {
          const fields = JSON.parse(webhook.fieldConfig);
          if (Array.isArray(fields)) {
            fields.forEach((f: { key?: string; name?: string }) => {
              const k = f.key || f.name;
              if (k) fieldKeys.add(k);
            });
          }
        } catch {}
      }

      const logs = await storage.getWebhookLogsByWebhookId(webhookId);
      for (const log of logs) {
        if (log.payload) {
          try {
            const parsed = JSON.parse(log.payload);
            Object.keys(parsed).forEach((k) => fieldKeys.add(k));
          } catch {}
        }
      }

      if (fieldKeys.size === 0 && webhook?.linkedWebhookId) {
        const linkedLogs = await storage.getWebhookLogsByWebhookId(webhook.linkedWebhookId);
        for (const log of linkedLogs) {
          if (log.payload) {
            try {
              const parsed = JSON.parse(log.payload);
              Object.keys(parsed).forEach((k) => fieldKeys.add(k));
            } catch {}
          }
        }
      }

      if (fieldKeys.has("action")) {
        fieldKeys.delete("action");
        fieldKeys.add("alert");
      }

      res.json(Array.from(fieldKeys).sort());
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch webhook signals" });
    }
  });

  app.get("/api/webhook-field-values/:webhookId/:fieldKey", async (req, res) => {
    try {
      const { webhookId, fieldKey } = req.params;
      const uniqueValues = new Set<string>();

      const extractValuesFromLogs = (logs: { payload?: string | null }[]) => {
        for (const log of logs) {
          const raw = log.payload || (log as any).rawPayload;
          if (raw) {
            try {
              const parsed = JSON.parse(raw);
              const val = parsed[fieldKey];
              if (val !== undefined && val !== null && val !== "") {
                uniqueValues.add(String(val));
              }
            } catch {}
          }
        }
      };

      const logs = await storage.getWebhookLogsByWebhookId(webhookId);
      extractValuesFromLogs(logs);

      if (uniqueValues.size === 0) {
        const webhook = await storage.getWebhook(webhookId);
        if (webhook?.linkedWebhookId) {
          const linkedLogs = await storage.getWebhookLogsByWebhookId(webhook.linkedWebhookId);
          extractValuesFromLogs(linkedLogs);

          if (uniqueValues.size === 0) {
            const domainSetting = await storage.getSetting('domain_name');
            const domainName = domainSetting?.value;
            if (domainName) {
              try {
                const prodResponse = await fetch(
                  `https://${domainName}/api/webhook-data/webhook/${webhook.linkedWebhookId}`
                );
                if (prodResponse.ok) {
                  const prodData = await prodResponse.json();
                  if (Array.isArray(prodData)) {
                    extractValuesFromLogs(prodData);
                  }
                }
              } catch (fetchError) {
                console.log("Failed to fetch production data for field values:", fetchError);
              }
            }
          }
        }
      }

      res.json(Array.from(uniqueValues).sort());
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch field values" });
    }
  });
}
