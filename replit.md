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

## Milestones

### [MILESTONE] HSM as single price source for TSL, SL, and Profit Target — verified 2026-05-11

**Finding:** All three exit systems (TSL trailing stop, plan-level SL, plan-level profit target) receive prices exclusively through HSM ticks when HSM is live. This was verified by tracing the full data flow from the HSM WS handler to each consumer.

**The single source — `artifacts/api-server/src/hsm-kotak-neo-v3.ts` lines 207–210:**
```typescript
if (symbol && ltp !== undefined) {
  marketData.updatePrice(symbol, Number(ltp));  // → MD priceCache (feeds MTM monitor SL/Profit)
  processTick(symbol, Number(ltp));              // → TSL engine directly (feeds trailing SL)
  updateLastWsTick();                            // → resets REST fallback staleness timer
}
```

**How each system uses it:**
- **TSL** (`artifacts/api-server/src/tsl-kotak-neo-v3.ts`): receives ticks directly via `processTick()` — real-time per tick
- **SL + Profit Target** (`artifacts/api-server/src/mtm-monitor.ts`): calls `getPrice()` from `artifacts/api-server/src/md-kotak-neo-v3.ts` — reads from `priceCache` kept fresh by `marketData.updatePrice()` above
- **MD price cache** (`artifacts/api-server/src/md-kotak-neo-v3.ts` line 22–25): `updatePrice()` sets cache + broadcasts SSE

**Fallback chain when HSM tick is NOT flowing** (`[MD-1]` invariant in `md-kotak-neo-v3.ts`):
1. WS cache (fresh < 2s) → immediate return
2. REST quote via `EL.getQuote()` → fetched on demand
3. Stale cache → last known price returned
- TSL additionally has its own REST fallback (`runRestFallbackTick()` in `tsl-kotak-neo-v3.ts` line ~196) — fires every 30s when `lastWsTickAt` is stale, calls `getPrice()` and pipes result into `processTick()`

**Diagnostic — if HSM tick stops working, check in order:**
1. `GET /api/admin/hsm/status` → `authOk` must be `true`, `subscriptionCount` must be > 0 when trades are open
2. `[HSM]` logs — look for `auth_ok` confirmation after connect; absence means Kotak HSM server not completing handshake
3. `[TSL]` logs — if REST fallback is active you will see fallback firing every ~30s instead of per-tick
4. `[MTM]` logs — SL/profit checks continue via REST but with quote-level latency

## Gotchas

- Do NOT run `pnpm dev` at workspace root — use `restart_workflow` instead
- `pnpm --filter @workspace/api-server run typecheck` may show legacy TS errors — acceptable per task scope
- Auth requires `REPLIT_DEPLOYMENT`, `REPL_ID`, `ISSUER_URL`, `SESSION_SECRET` env vars for Replit Auth; TOTP/email auth works without them
- DB push requires drizzle-kit; run `pnpm install` first if it fails with MODULE_NOT_FOUND

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details

### [MILESTONE] Agent skills restored and milestone-logging established — verified 2026-05-11

**Task:** Skills setup — pre-build-checklist, sop-bop, milestone-logging

**What changed:** Three agent skills created in `.agents/skills/` making them active for all future tasks. Two were recovered from `.migration-backup/` (had never been active in the monorepo). One is new.

**Key files:**
- `.agents/skills/pre-build-checklist/SKILL.md` — mandatory architectural gate before any code is written; file paths updated from old structure to current monorepo (`lib/db/src/schema/schema.ts`, `artifacts/api-server/src/`)
- `.agents/skills/sop-bop/SKILL.md` — 8-step broker onboarding process; paths updated to monorepo structure
- `.agents/skills/milestone-logging/SKILL.md` — new skill; instructs agent to append a `### [MILESTONE]` block to `replit.md` before every `mark_task_complete`

**How it works:** Skills in `.agents/skills/` are read automatically when their description matches the current task context. `milestone-logging` description says "before marking any task complete" — this is the trigger that makes it run on every task, same pattern as `follow-up-tasks`.

**Diagnostic — if skills stop being followed:**
1. Confirm files exist at `.agents/skills/*/SKILL.md` (not in `.migration-backup/`)
2. Check skill `description` frontmatter — that's the discovery trigger
3. `pre-build-checklist` must be referenced before any code is written; `milestone-logging` before `mark_task_complete`

### [MILESTONE] HSM full binary protocol — subscriptions, heartbeat, DATA_TYPE decode — verified 2026-05-11

**Task:** #245 — Fix HSM binary protocol so live market data ticks flow

**What changed:** Replaced all remaining JSON wire frames with the correct binary protocol derived from `hslib.js`. Subscriptions now send binary SUBSCRIBE_TYPE=4 frames with `sf|nse_fo|{token}` encoding. Heartbeat sends binary THROTTLING_TYPE=2 frames (11 bytes). Incoming DATA_TYPE=6 frames are decoded (SNAP establishes topicId→symbol, UPDATE extracts float32 LTP) and fed to all downstream consumers.

**Key files:**
- `artifacts/api-server/src/hsm-kotak-neo-v3.ts` — added `buildHsmSubscribeBinary`, `buildHsmHeartbeatBinary`, `buildHsmAckBinary`, `emitTick`; updated `resubscribeAll`, `subscribe`, `startHsmHeartbeat`; added DATA_TYPE=6 decode block in message handler; added `topicList` and `lastTickLogAt` at module scope

**How it works:**
- **Subscribe**: `buildHsmSubscribeBinary(tokens[])` → `[uint16BE payloadLen][4=SUBSCRIBE_TYPE][2=fieldCount][1=fid:scrips][uint16BE scripByteArrayLen][[uint16BE count][for each: byte len + "sf|nse_fo|{token}"]][2=fid:channel][uint16BE 1][byte 1]`
- **Heartbeat**: `buildHsmHeartbeatBinary()` → 11 bytes: `[uint16BE 9][2=THROTTLING][1][1][uint16BE 4][uint32BE 0]`
- **DATA_TYPE decode**: `buf[2]===6` → read ackNum, send ACK if needed, loop sub-packets: SNAP(83) extracts token from topic name "sf|nse_fo|{token}", reads float32 LTP at long-field index 5, stores topicId→symbol in `topicList`; UPDATE(85) reads topicId from `topicList` for O(1) symbol lookup, reads float32 LTP at index 5, calls `emitTick`
- **emitTick**: calls `marketData.updatePrice` + `processTick` + `updateLastWsTick`, throttle-logs at most once per 10s per symbol

**Diagnostic — if ticks stop flowing after this build:**
1. `[HSM] auth_ok received` must appear in logs — if not, auth broke (check Task #244 path)
2. `[HSM] Resubscribed N symbol(s) via binary frame` must appear after connect when open trades exist
3. First SNAP tick will log `[HSM] Tick {symbol} ltp={price}` — if missing, check `brokerSymbolToTokenMap` has the token (scrip master may not have loaded)
4. If SNAP arrives but UPDATE ticks silent: `topicList` may be empty — check SNAP parsing didn't throw (add try/catch log temporarily)
5. Frame byte layout verified against `ByteData` constructor + `prepareSubsUnSubsRequest` + `getScripByteArray` in `artifacts/api-server/public/kotak-test/hslib.js`
