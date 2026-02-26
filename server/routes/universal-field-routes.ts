import type { Express } from "express";
import type { IStorage } from "../storage";

export function registerUniversalFieldRoutes(app: Express, storage: IStorage) {
  app.get("/api/universal-fields", async (req, res) => {
    try {
      const { category } = req.query;
      const fields = await storage.getUniversalFields(category as string | undefined);
      res.json(fields);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch universal fields" });
    }
  });

  app.get("/api/universal-fields/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
      const field = await storage.getUniversalField(id);
      if (!field) return res.status(404).json({ error: "Universal field not found" });
      res.json(field);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch universal field" });
    }
  });

  app.post("/api/universal-fields", async (req, res) => {
    try {
      const { fieldName, displayName, category, dataType, description } = req.body;
      if (!fieldName || !displayName || !category || !dataType) {
        return res.status(400).json({ error: "fieldName, displayName, category, and dataType are required" });
      }
      const field = await storage.createUniversalField({ fieldName, displayName, category, dataType, description });
      res.status(201).json(field);
    } catch (error: any) {
      if (error?.code === "23505") {
        return res.status(409).json({ error: "A universal field with this name already exists" });
      }
      res.status(500).json({ error: "Failed to create universal field" });
    }
  });

  app.patch("/api/universal-fields/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
      const updated = await storage.updateUniversalField(id, req.body);
      if (!updated) return res.status(404).json({ error: "Universal field not found" });
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: "Failed to update universal field" });
    }
  });

  app.delete("/api/universal-fields/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
      const deleted = await storage.deleteUniversalField(id);
      if (!deleted) return res.status(404).json({ error: "Universal field not found" });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete universal field" });
    }
  });

  app.post("/api/universal-fields/sync-to-production", async (req, res) => {
    try {
      const domainSetting = await storage.getSetting("domain_name");
      if (!domainSetting || !domainSetting.value) {
        return res.status(400).json({ error: "Production domain not configured. Set domain name in settings." });
      }

      const devUniversalFields = await storage.getUniversalFields();
      if (devUniversalFields.length === 0) {
        return res.status(404).json({ error: "No universal fields found in development" });
      }

      console.log(`[sync-uf] Sending ${devUniversalFields.length} universal fields to production`);

      const productionUrl = `https://${domainSetting.value}/api/universal-fields/sync-receive`;

      const response = await fetch(productionUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-sync-key": process.env.SESSION_SECRET || "",
        },
        body: JSON.stringify({ universalFields: devUniversalFields }),
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok) {
        const errText = await response.text();
        return res.status(502).json({ error: `Production sync failed: ${response.status} ${errText}` });
      }

      const result = await response.json();
      res.json(result);
    } catch (error: any) {
      console.error("Failed to sync universal fields to production:", error);
      res.status(500).json({ error: `Sync failed: ${error.message}` });
    }
  });

  app.post("/api/universal-fields/sync-receive", async (req, res) => {
    try {
      const syncKey = req.headers["x-sync-key"];
      if (syncKey !== process.env.SESSION_SECRET) {
        return res.status(403).json({ error: "Forbidden" });
      }

      const { universalFields } = req.body;
      if (!universalFields || !Array.isArray(universalFields)) {
        return res.status(400).json({ error: "universalFields[] required" });
      }

      console.log(`[sync-uf-receive] Received ${universalFields.length} universal fields`);

      const { db: database } = await import("../db");
      const schema = await import("@shared/schema");
      const { sql } = await import("drizzle-orm");

      const existingCount = await database.select({ count: sql<number>`count(*)` }).from(schema.universal_fields);
      console.log(`[sync-uf-receive] Existing universal fields in production: ${existingCount[0].count}`);

      await database.delete(schema.universal_fields).execute();
      console.log(`[sync-uf-receive] Deleted all existing universal fields`);

      let inserted = 0;
      for (const uf of universalFields) {
        await database.insert(schema.universal_fields).values({
          fieldName: uf.fieldName || uf.field_name,
          displayName: uf.displayName || uf.display_name,
          category: uf.category,
          dataType: uf.dataType || uf.data_type || "string",
          description: uf.description || null,
        }).execute();
        inserted++;
      }

      console.log(`[sync-uf-receive] Inserted ${inserted} universal fields`);

      res.json({
        success: true,
        synced: inserted,
        message: `${inserted} universal fields synced to production`,
      });
    } catch (error: any) {
      console.error("Failed to receive universal fields sync:", error);
      res.status(500).json({ error: `Sync receive failed: ${error.message}` });
    }
  });
}
