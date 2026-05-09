# MentorsWorld Algo Trading Platform

An automated algorithmic trading platform integrating with Kotak Neo broker API. Supports strategy management, webhook-triggered trade execution, broker configuration, real-time P&L tracking, and admin controls.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port from $PORT)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5, http.createServer (SSE + WS support)
- DB: PostgreSQL + Drizzle ORM
- Frontend: React + Vite + Tailwind v3 + wouter routing
- Auth: Replit Auth (openid-client/passport) + custom team auth with TOTP
- Broker: Kotak Neo v3 API
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/mentors-world/` — React frontend (previewPath `/`)
- `artifacts/api-server/` — Express backend (previewPath `/api`)
- `lib/db/src/schema/schema.ts` — source-of-truth DB schema
- `lib/db/src/schema/models/auth.ts` — auth tables (users, sessions, invitations)
- `artifacts/api-server/src/routes/` — all API route files
- `artifacts/api-server/src/storage.ts` — data access layer (IStorage interface)
- `artifacts/api-server/src/replit_integrations/auth/` — auth middleware + routes
- `.migration-backup/` — original app preserved as reference

## Architecture decisions

- Large legacy app: OpenAPI spec skipped; existing frontend fetch layer preserved (too many endpoints to rewrite safely)
- `registerRoutes(httpServer, app)` pattern kept (complex SSE, WS, middleware) — not refactored to Express Router
- auth models (`users`, `sessions`, `invitations`) live both in `lib/db/src/schema/models/auth.ts` (for DB push) and `artifacts/api-server/src/models/auth.ts` (for runtime use)
- Tailwind v3 used (not v4) — PostCSS config + tailwind.config.ts in frontend artifact
- wouter Router wraps App with `base={import.meta.env.BASE_URL}` for path-based proxy routing

## Product

- Landing page with sign-in / get-started flow
- Dashboard: live P&L, open trades, broker capital
- Strategies: configure algo trading plans with entry/exit rules
- Webhooks: receive TradingView alerts, map to broker orders
- Broker API: connect/manage Kotak Neo accounts
- Settings + User Management (super-admin only)
- Real-time SSE streaming for trade/plan status updates

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- Do NOT run `pnpm dev` at workspace root — use `restart_workflow` instead
- `pnpm --filter @workspace/api-server run typecheck` may show legacy TS errors — acceptable per task scope
- Auth requires `REPLIT_DEPLOYMENT`, `REPL_ID`, `ISSUER_URL`, `SESSION_SECRET` env vars for Replit Auth; TOTP/email auth works without them
- DB push requires drizzle-kit; run `pnpm install` first if it fails with MODULE_NOT_FOUND

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
