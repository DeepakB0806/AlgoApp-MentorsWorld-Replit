import type { Express } from "express";
import type { IStorage } from "../storage";

export function registerFieldMappingRoutes(app: Express, storage: IStorage) {
  app.post("/api/broker-field-mappings/build", async (req, res) => {
    try {
      const { brokerName, sections } = req.body;
      if (!brokerName || !sections || !Array.isArray(sections)) {
        return res.status(400).json({ error: "brokerName and sections[] required" });
      }

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
            const universalName = existingByFieldCode[f.field] || null;
            const matchStatus = universalName ? "matched" : "pending";
            fields.push({
              brokerName,
              category,
              fieldCode: f.field,
              fieldName: f.field,
              fieldType: f.type || "string",
              fieldDescription: f.desc || null,
              direction,
              endpoint: endpoint.replace(/^(GET|POST|PUT|DELETE|PATCH)\s+/, ""),
              universalFieldName: universalName,
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

  app.patch("/api/broker-field-mappings/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
      const updated = await storage.updateBrokerFieldMapping(id, req.body);
      if (!updated) return res.status(404).json({ error: "Mapping not found" });
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: "Failed to update broker field mapping" });
    }
  });
}
