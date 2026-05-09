import type { Express } from "express";
import type { IStorage } from "../storage";
import TL from "../tl-kotak-neo-v3";
import EL from "../el-kotak-neo-v3";

export function registerFieldMappingRoutes(app: Express, storage: IStorage) {
  app.get("/api/el/kotak_neo_v3/status", async (_req, res) => {
    try {
      const status = EL.getStatus();
      res.json(status);
    } catch (error: any) {
      res.status(500).json({ error: `Failed to get EL status: ${error.message}` });
    }
  });

  app.post("/api/el/kotak_neo_v3/reload", async (_req, res) => {
    try {
      await EL.reload();
      const status = EL.getStatus();
      res.json({ success: true, message: "Execution Layer reloaded", ...status });
    } catch (error: any) {
      res.status(500).json({ error: `Failed to reload EL: ${error.message}` });
    }
  });

  app.get("/api/tl/kotak_neo_v3/status", async (_req, res) => {
    try {
      const status = TL.getStatus();
      res.json(status);
    } catch (error: any) {
      res.status(500).json({ error: `Failed to get TL status: ${error.message}` });
    }
  });

  app.post("/api/tl/kotak_neo_v3/reload", async (_req, res) => {
    try {
      await TL.reload();
      const status = TL.getStatus();
      res.json({ success: true, message: "Translation Layer reloaded", ...status });
    } catch (error: any) {
      res.status(500).json({ error: `Failed to reload TL: ${error.message}` });
    }
  });

  app.post("/api/broker-field-mappings/build", async (req, res) => {
    try {
      const { brokerName, sections } = req.body;
      if (!brokerName || !sections || !Array.isArray(sections)) {
        return res.status(400).json({ error: "brokerName and sections[] required" });
      }

      const universalFields = await storage.getUniversalFields();
      const validUniversalNames = new Set(universalFields.map(f => f.fieldName));
      const lowerToOriginal = new Map(universalFields.map(f => [f.fieldName.toLowerCase(), f.fieldName]));

      const existingMappings = await storage.getBrokerFieldMappings(brokerName);
      const existingByFieldCode: Record<string, string> = {};
      for (const m of existingMappings) {
        if (m.universalFieldName && m.matchStatus === "matched") {
          existingByFieldCode[m.fieldCode] = m.universalFieldName;
        }
      }

      const fields: any[] = [];
      let sortOrder = 0;

      for (const section of sections) {
        const category = section.key;
        for (const sub of (section.subsections || [])) {
          const endpoint = sub.endpoint || "";
          const direction = endpoint.startsWith("GET") ? "response" : "request";
          for (const f of (sub.fields || [])) {
            let universalName = existingByFieldCode[f.field] || null;
            if (universalName && !validUniversalNames.has(universalName)) {
              const corrected = lowerToOriginal.get(universalName.toLowerCase());
              universalName = corrected || null;
            }
            const isValidMatch = universalName && validUniversalNames.has(universalName);
            const matchStatus = isValidMatch ? "matched" : "pending";
            fields.push({
              brokerName,
              category,
              fieldCode: f.field,
              fieldName: f.field,
              fieldType: f.type || "string",
              fieldDescription: f.desc || null,
              direction,
              endpoint: endpoint.replace(/^(GET|POST|PUT|DELETE|PATCH)\s+/, ""),
              universalFieldName: isValidMatch ? universalName : null,
              matchStatus,
              allowedValues: null,
              defaultValue: null,
              isRequired: false,
              sortOrder: sortOrder++,
              notes: null,
            });
          }
        }
      }

      await storage.deleteBrokerFieldMappings(brokerName);
      const results = await storage.upsertBrokerFieldMappings(fields);
      const stats = await storage.getBrokerFieldMappingStats(brokerName);

      res.json({
        success: true,
        total: results.length,
        stats,
        fields: results,
      });
    } catch (error) {
      console.error("Failed to build broker field mappings:", error);
      res.status(500).json({ error: "Failed to build broker field mappings" });
    }
  });

  app.get("/api/broker-field-mappings/:brokerName", async (req, res) => {
    try {
      const { category } = req.query;
      const fields = await storage.getBrokerFieldMappings(req.params.brokerName, category as string | undefined);
      res.json(fields);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch broker field mappings" });
    }
  });

  app.get("/api/broker-field-mappings/:brokerName/stats", async (req, res) => {
    try {
      const stats = await storage.getBrokerFieldMappingStats(req.params.brokerName);
      res.json(stats);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch broker field mapping stats" });
    }
  });

  app.get("/api/broker-field-mappings/:brokerName/cross-reference", async (req, res) => {
    try {
      const brokerName = req.params.brokerName;
      const [brokerMappings, universalFields] = await Promise.all([
        storage.getBrokerFieldMappings(brokerName),
        storage.getUniversalFields(),
      ]);

      const matchedUniversalNames = new Set<string>();
      const unmatchedBrokerFields: { fieldCode: string; category: string; endpoint: string }[] = [];

      for (const m of brokerMappings) {
        if (m.matchStatus === "matched" && m.universalFieldName) {
          matchedUniversalNames.add(m.universalFieldName);
        } else {
          unmatchedBrokerFields.push({ fieldCode: m.fieldCode, category: m.category, endpoint: m.endpoint || "" });
        }
      }

      const coveredUniversal: { fieldName: string; category: string }[] = [];
      const uncoveredUniversal: { fieldName: string; category: string; displayName: string }[] = [];

      for (const uf of universalFields) {
        if (matchedUniversalNames.has(uf.fieldName)) {
          coveredUniversal.push({ fieldName: uf.fieldName, category: uf.category });
        } else {
          uncoveredUniversal.push({ fieldName: uf.fieldName, category: uf.category, displayName: uf.displayName });
        }
      }

      res.json({
        broker: {
          total: brokerMappings.length,
          matched: brokerMappings.filter(m => m.matchStatus === "matched").length,
          unmatched: unmatchedBrokerFields.length,
          unmatchedFields: unmatchedBrokerFields,
        },
        universal: {
          total: universalFields.length,
          covered: coveredUniversal.length,
          uncovered: uncoveredUniversal.length,
          uncoveredFields: uncoveredUniversal,
        },
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch cross-reference data" });
    }
  });

  app.post("/api/broker-field-mappings/:brokerName/revalidate", async (req, res) => {
    try {
      const brokerName = req.params.brokerName;
      const [brokerMappings, universalFields] = await Promise.all([
        storage.getBrokerFieldMappings(brokerName),
        storage.getUniversalFields(),
      ]);

      if (brokerMappings.length === 0) {
        return res.status(404).json({ error: "No broker field mappings found" });
      }

      const validNames = new Set(universalFields.map(f => f.fieldName));
      const lowerToOriginal = new Map(universalFields.map(f => [f.fieldName.toLowerCase(), f.fieldName]));

      let updated = 0;
      let matched = 0;
      let pending = 0;
      let unmapped = 0;
      const corrections: { fieldCode: string; from: string; to: string }[] = [];
      const matchedUniversalNames = new Set<string>();
      const unverifiedFields: { fieldCode: string; universalFieldName: string; category: string }[] = [];

      for (const m of brokerMappings) {
        let newStatus = m.matchStatus;
        let newUniversalName = m.universalFieldName;

        if (m.universalFieldName) {
          if (validNames.has(m.universalFieldName)) {
            newStatus = "matched";
          } else {
            const corrected = lowerToOriginal.get(m.universalFieldName.toLowerCase());
            if (corrected) {
              newUniversalName = corrected;
              newStatus = "matched";
              corrections.push({ fieldCode: m.fieldCode, from: m.universalFieldName, to: corrected });
            } else {
              newStatus = "pending";
              unverifiedFields.push({ fieldCode: m.fieldCode, universalFieldName: m.universalFieldName, category: m.category });
            }
          }
        } else {
          newStatus = "pending";
          unmapped++;
        }

        if (newStatus !== m.matchStatus || newUniversalName !== m.universalFieldName) {
          await storage.updateBrokerFieldMapping(m.id, {
            matchStatus: newStatus,
            universalFieldName: newUniversalName,
          } as any);
          updated++;
        }

        if (newStatus === "matched" && newUniversalName) {
          matched++;
          matchedUniversalNames.add(newUniversalName);
        } else {
          pending++;
        }
      }

      const uncoveredUniversal: { fieldName: string; category: string; displayName: string }[] = [];
      for (const uf of universalFields) {
        if (!matchedUniversalNames.has(uf.fieldName)) {
          uncoveredUniversal.push({ fieldName: uf.fieldName, category: uf.category, displayName: uf.displayName });
        }
      }

      res.json({
        success: true,
        broker: {
          total: brokerMappings.length,
          matched,
          pending,
          unmapped,
          unverified: unverifiedFields.length,
          unverifiedFields,
          updated,
          corrections,
        },
        universal: {
          total: universalFields.length,
          covered: matchedUniversalNames.size,
          uncovered: uncoveredUniversal.length,
          uncoveredFields: uncoveredUniversal,
        },
      });
    } catch (error) {
      console.error("Failed to revalidate broker field mappings:", error);
      res.status(500).json({ error: "Failed to revalidate broker field mappings" });
    }
  });

  app.post("/api/broker-field-mappings/sync-to-production", async (req, res) => {
    try {
      const { brokerName } = req.body;
      if (!brokerName) {
        return res.status(400).json({ error: "brokerName required" });
      }

      const domainSetting = await storage.getSetting("domain_name");
      if (!domainSetting || !domainSetting.value) {
        return res.status(400).json({ error: "Production domain not configured. Set domain name in settings." });
      }

      const devMappings = await storage.getBrokerFieldMappings(brokerName);
      if (devMappings.length === 0) {
        return res.status(404).json({ error: "No broker field mappings found in development" });
      }

      const devUniversalFields = await storage.getUniversalFields();

      const productionUrl = `https://${domainSetting.value}/api/broker-field-mappings/sync-receive`;

      const response = await fetch(productionUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-sync-key": process.env.SESSION_SECRET || "",
        },
        body: JSON.stringify({ brokerName, mappings: devMappings, universalFields: devUniversalFields }),
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok) {
        const errText = await response.text();
        return res.status(502).json({ error: `Production sync failed: ${response.status} ${errText}` });
      }

      const result = await response.json();
      res.json(result);
    } catch (error: any) {
      console.error("Failed to sync to production:", error);
      res.status(500).json({ error: `Sync failed: ${error.message}` });
    }
  });

  app.post("/api/broker-field-mappings/sync-receive", async (req, res) => {
    try {
      const syncKey = req.headers["x-sync-key"];
      if (syncKey !== process.env.SESSION_SECRET) {
        return res.status(403).json({ error: "Forbidden" });
      }

      const { brokerName, mappings, universalFields: incomingUniversalFields } = req.body;
      if (!brokerName || !mappings || !Array.isArray(mappings)) {
        return res.status(400).json({ error: "brokerName and mappings[] required" });
      }

      const { db: database } = await import("../db");
      const schema = await import("@shared/schema");

      let ufSynced = 0;
      if (incomingUniversalFields && Array.isArray(incomingUniversalFields)) {
        for (const uf of incomingUniversalFields) {
          const inserted = await database.insert(schema.universal_fields).values({
            fieldName: uf.fieldName || uf.field_name,
            displayName: uf.displayName || uf.display_name,
            category: uf.category,
            dataType: uf.dataType || uf.data_type || "string",
            description: uf.description || null,
          }).onConflictDoNothing().returning();
          if (inserted.length > 0) ufSynced++;
        }
        console.log(`[sync-receive] Universal fields: ${incomingUniversalFields.length} received, ${ufSynced} new`);
      }

      const deleted = await storage.deleteBrokerFieldMappings(brokerName);
      console.log(`[sync-receive] Deleted ${deleted} existing broker mappings for ${brokerName}`);

      const withUniversal = mappings.filter((m: any) => m.universalFieldName || m.universal_field_name).length;
      const withMatched = mappings.filter((m: any) => (m.matchStatus || m.match_status) === "matched").length;
      console.log(`[sync-receive] Incoming: ${mappings.length} mappings, ${withUniversal} with universalFieldName, ${withMatched} matched`);

      const fields = mappings.map((m: any, i: number) => ({
        brokerName: m.brokerName || m.broker_name || brokerName,
        category: m.category,
        fieldCode: m.fieldCode || m.field_code,
        fieldName: m.fieldName || m.field_name,
        fieldType: m.fieldType || m.field_type || "string",
        fieldDescription: m.fieldDescription || m.field_description || null,
        direction: m.direction || "request",
        endpoint: m.endpoint || null,
        universalFieldName: m.universalFieldName || m.universal_field_name || null,
        matchStatus: m.matchStatus || m.match_status || "pending",
        allowedValues: m.allowedValues || m.allowed_values || null,
        defaultValue: m.defaultValue || m.default_value || null,
        isRequired: m.isRequired ?? m.is_required ?? false,
        sortOrder: m.sortOrder ?? m.sort_order ?? i,
        notes: m.notes || null,
      }));

      const results: any[] = [];
      for (const field of fields) {
        const [inserted] = await database.insert(schema.broker_field_mappings).values(field).returning();
        results.push(inserted);
      }

      const finalWithUniversal = results.filter((r: any) => r.universalFieldName).length;
      const finalMatched = results.filter((r: any) => r.matchStatus === "matched").length;
      console.log(`[sync-receive] Inserted: ${results.length} rows, ${finalWithUniversal} with universalFieldName, ${finalMatched} matched`);

      const stats = await storage.getBrokerFieldMappingStats(brokerName);

      res.json({
        success: true,
        synced: results.length,
        universalFieldsSynced: ufSynced,
        stats,
      });
    } catch (error: any) {
      console.error("Failed to receive sync:", error);
      res.status(500).json({ error: `Sync receive failed: ${error.message}` });
    }
  });

  app.patch("/api/broker-field-mappings/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });

      const { universalFieldName, matchStatus } = req.body;

      if (universalFieldName !== undefined || matchStatus === "matched") {
        const universalFields = await storage.getUniversalFields();
        const validNames = new Set(universalFields.map(f => f.fieldName));
        const lowerToOriginal = new Map(universalFields.map(f => [f.fieldName.toLowerCase(), f.fieldName]));

        if (universalFieldName) {
          if (!validNames.has(universalFieldName)) {
            const corrected = lowerToOriginal.get(universalFieldName.toLowerCase());
            if (corrected) {
              req.body.universalFieldName = corrected;
            } else {
              return res.status(400).json({ error: `Universal field "${universalFieldName}" does not exist in the universal_fields table` });
            }
          }
        }

        if (matchStatus === "matched") {
          let nameToCheck = req.body.universalFieldName || universalFieldName;
          if (!nameToCheck) {
            const current = await storage.getBrokerFieldMappingById(id);
            nameToCheck = current?.universalFieldName || null;
          }
          if (!nameToCheck || (!validNames.has(nameToCheck) && !lowerToOriginal.has(nameToCheck.toLowerCase()))) {
            return res.status(400).json({ error: `Cannot set status to "matched": universal field "${nameToCheck || ''}" does not exist in the universal_fields table` });
          }
        }
      }

      const updated = await storage.updateBrokerFieldMapping(id, req.body);
      if (!updated) return res.status(404).json({ error: "Mapping not found" });
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: "Failed to update broker field mapping" });
    }
  });
}
