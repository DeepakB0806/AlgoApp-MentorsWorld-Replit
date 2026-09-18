---
name: Drizzle-Zod compatibility
description: The workspace's drizzle-zod type declarations target the Zod v4 entrypoint.
---

Use `zod/v4` when a schema file imports `createInsertSchema` from `drizzle-zod`; importing the default `zod` entrypoint creates incompatible schema types during TypeScript checking.

**Why:** The installed drizzle-zod declarations build against `zod/v4`, while the workspace also exposes a Zod v3-compatible default entrypoint. Mixing them produces broad `ZodObject`/`ZodType` errors.

**How to apply:** When adding or repairing Drizzle-derived schemas in this workspace, keep the Zod import aligned with drizzle-zod's declared entrypoint before investigating individual type errors.