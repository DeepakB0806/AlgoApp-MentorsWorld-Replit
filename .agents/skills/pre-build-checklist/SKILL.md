---
name: pre-build-checklist
description: Mandatory architectural gate. Load and answer this checklist before writing any code for any task.
---

# Pre-Build Architecture Checklist

This checklist is MANDATORY. Answer every question explicitly before writing any implementation code.
Skip no question. If the answer is unclear, read the relevant files until it is clear.

---

## Q1 — Does this feature introduce new data fields?

For every new field visible in the UI or processed by the backend, ask:
- Is this field persisted to the database?
  - YES → a schema column is required. Do NOT write any other code until the column exists.
  - NO  → document why (e.g. computed at runtime, in-memory only, config only)

**Rule**: If any answer is YES, Step 1 of the task plan must be the schema change. No exceptions.

---

## Q2 — For each new persisted field, identify:

| Field name | DB table | Drizzle column type | Nullable? |
|---|---|---|---|
| (fill in) | (fill in) | text / real / integer / boolean / timestamp | yes / no |

All tables are defined in `lib/db/src/schema/schema.ts`.
Common tables: `strategyTrades`, `strategyPlans`, `brokerConfigs`, `webhookData`.

---

## Q3 — Schema change execution order (non-negotiable):

1. Edit `lib/db/src/schema/schema.ts` — add the column to the correct pgTable
2. Run `pnpm --filter @workspace/db run push` — applies the migration to the live database
3. Confirm the column exists: run a quick SELECT or check DB introspection
4. ONLY THEN write storage, backend, and frontend code

---

## Q4 — Which TypeScript types need manual updates?

Auto-derived (no manual change needed):
- Insert schemas and similar — auto-derived via `createInsertSchema`
- Select types (e.g. `StrategyTrade`, `StrategyPlan`) — auto-derived via `$inferSelect`

Require MANUAL update:
- Shared config types: `TrailingStoplossConfig`, `BlockConfig`, `TradeParams`, etc.
- Zod schemas used in forms or API validation
- Any `interface` or `type` that mirrors the new field
- Frontend interfaces in `artifacts/mentors-world/src/` that model API responses

---

## Q5 — Existing queries and writes — do they need updating?

For the table that gained new columns:
- SELECT queries that fetch full rows: do they need to include the new column? (usually auto-included via `db.select()`)
- INSERT/UPDATE calls: do they need to pass the new field? Update all relevant calls in `artifacts/api-server/src/storage.ts`.
- Any raw SQL or `.set({...})` calls that enumerate columns explicitly: add the new column.

---

## Q6 — Does the feature read external data provided by a third-party spec?

If YES (e.g. a Gemini spec, a PDF, a demo file, user-written pseudocode):
- Treat the external spec as a STARTING POINT only
- Re-derive every data field from first principles using Q1–Q5 above
- Do NOT copy field names from the spec without verifying they exist in the schema
- Do NOT assume the spec includes schema steps — it almost never does

---

## Checklist sign-off

Before writing code, confirm all 6 questions are answered.
Write a one-line summary: "Schema change needed: YES/NO. New columns: [list]. Migration: db:push."

## Key file locations (monorepo)

- Schema: `lib/db/src/schema/schema.ts`
- Storage/data layer: `artifacts/api-server/src/storage.ts`
- API routes: `artifacts/api-server/src/routes/`
- Frontend pages: `artifacts/mentors-world/src/pages/`
- Frontend components: `artifacts/mentors-world/src/components/`
