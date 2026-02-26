import type { Express } from "express";
import type { IStorage } from "../storage";

export function registerFieldMappingRoutes(app: Express, storage: IStorage) {
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
