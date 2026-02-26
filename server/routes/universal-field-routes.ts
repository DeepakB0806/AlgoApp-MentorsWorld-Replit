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
}
