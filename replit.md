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

## Multi-broker scaling model

The platform is designed to scale to multiple brokers without changing the core strategy or fit-check logic:

- **Margins are broker-specific** — each strategy is deployed under a specific broker. Margin data (via API and/or CSV) is fetched from that broker's own endpoints. A Kotak Neo plan uses Kotak Neo margin rates; a future Zerodha plan would use Zerodha's rates.
- **Available Funds are UCC-specific per broker** — the capital snapshot (available funds) belongs to a UCC on a particular broker, not a pooled cross-broker figure. The fit check groups plans by UCC + brokerConfig and evaluates each group independently.
- **To onboard a new broker** — add a new section under Broker API alongside the existing Kotak Neo section. Each broker gets its own connection flow, credential management, margin engine, and capital snapshot. No changes needed to strategies, webhooks, fit-check, or TSL/SL logic — they already key off `brokerConfigId`.
- **UI pattern** — the Broker API page will grow one link/tab per broker (e.g. Kotak Neo | Zerodha | …). Each tab manages connections for that broker only.

## Milestones

### [MILESTONE] HSI-Driven Trade Confirmation + MTM Sanity Guard — verified 2026-05-12

**Task:** #253 — HSI-Driven Trade Confirmation (Primary) + REST Fallback

**What changed:** HSI is now the primary source for fill prices on both entry and exit orders. REST `getOrderHistory` is a 10s-timeout fallback only. `ctx.price` (index spot) can never be stored as a fill price again. Ghost exit trades are addressed by 3-retry DB writes and the HSI exit registry. The MTM monitor skips any NFO/BFO leg whose `entryPrice > 5000` as a safety net for any stale records already in the DB.

**Key files:**
- `artifacts/api-server/src/hsi-kotak-neo-v3.ts` — full refactor: singleton vars → per-UCC `HsiState` instances (`hsiInstances` Map); `orderConfirmRegistry` + `exitOrderRegistry` exported; `handleOrderConfirm()` updates entry fill price and closes exit trade (3-retry) on every `trade`/`order COMPLETE` event; `startHsiGateway` loops all connected Kotak Neo configs
- `artifacts/api-server/src/te-kotak-neo-v3.ts` — `getFillPrice` rewritten: Step 1 = HSI callback (10s timeout), Step 2 = REST fallback, Step 3 = `0` (never `ctx.price`); `closeTrade` registers `closeOrderId → tradeId` in exit registry before calling `getFillPrice`; pre-write check skips final `updateStrategyTrade` if HSI already closed the trade; 3-retry wrapper on the "closed" DB write
- `artifacts/api-server/src/storage.ts` — `getTradeByOrderId(orderId)` added to `IStorage` interface + `DatabaseStorage`; queries `strategy_trades.order_id`
- `artifacts/api-server/src/mtm-monitor.ts` — sanity guard in `computePlanMTM`: skips NFO/BFO legs where `entryPrice > 5000`, logs `[MTM-MONITOR] WARN: skipping {symbol} — entry price ₹{price} looks like index spot`

**How it works:**
- **Entry fill price**: `closeTrade` (or entry basket) gets an `orderId` → `getFillPrice` registers a callback in `orderConfirmRegistry` and races a 10s `Promise`. HSI fires `order COMPLETE` → `handleOrderConfirm` resolves the callback with `avgPrc` AND proactively writes `strategy_trades.price = avgPrc`. `getFillPrice` returns in < 1s in normal operation. If HSI is down, REST `getOrderHistory` runs (existing logic). If REST also fails → return `0` → MTM guard skips the leg.
- **Exit confirmation**: `closeTrade` calls `registerExitOrder(closeOrderId, trade.id)` immediately after order placement. HSI fires → `handleOrderConfirm` writes `status=closed, exitPrice=avgPrc, pnl=calculated` with 3 retries. `closeTrade`'s own final write checks `getStrategyTrade(id)` first — if already closed with a valid exitPrice, it skips to avoid overwrite.
- **Per-UCC instances**: `startHsiGateway` now iterates all connected `kotak_neo` broker configs and starts one independent `HsiState` + WS + heartbeat per config. `getHsiStatus()` reads from the first instance (backward-compat with existing status routes).

**Diagnostic — if this breaks, check:**
1. `[HSI] Starting HSI instance for UCC=...` must appear once per connected Kotak Neo broker config on startup
2. `[HSI] Auth confirmed (cn ok)` must appear for each instance — if missing, relay/direct fallback path applies
3. `[TE] Fill price from HSI (XXXXXXXX): ₹N.NN [order]` must appear after any order placement — if `[TE] WARN: HSI fill confirmation timeout` appears instead, HSI is disconnected and REST fallback is active
4. `[HSI] Entry fill confirmed: {symbol} orderId=... avgPrc=N` and/or `[HSI] Exit confirmed via HSI: tradeId=... avgPrc=N` confirm proactive DB writes fired
5. `[MTM-MONITOR] WARN: skipping {symbol} — entry price ₹N looks like index spot` means an old stale trade with wrong entryPrice is being safely skipped

### [MILESTONE] Margin Scheduler Fix + Expiry Day Badge — verified 2026-05-12

**Task #251** — Two margin calculation fixes:

**Fix 1 — Scheduler no longer skips after restart/republish:**
Root cause: `runMarginCalcForAllBrokers` required `isPrimary && isConnected` to find a broker, but neither flag was set on "Kotak Neo - Production" after server restart. Changed to: prefer `isPrimary` first, fall back to any connected Kotak Neo broker, then any configured Kotak Neo broker. Also removed the redundant `isPrimary` guard inside `calculatePlanMargins` itself (caller is now responsible for broker selection). `isMarginsCalculatedToday` guard updated with same fallback logic.

**Fix 2 — `isExpiryMargin` DB column + "Expiry" badge:**
Added `is_expiry_margin boolean` to `strategy_plans` table. `calculatePlanMargins` now persists `isExpiryMargin: isExpiry` alongside `estimatedMargin` and `marginCalculatedAt`. The Settings margin table shows an orange "Expiry" badge next to the figure when `isExpiryMargin=true`.

**Verified from logs (2026-05-12 restart):**
- `[MARGIN-SCHED] 09:12 IST — running calculatePlanMargins for primary broker 2KVW9` ✅
- `EXPIRY DAY: spanRate ×1.16 → 11.60%` applied to both NIFTY plans ✅ (Tuesday IS expiry day for these plans)
- `[MARGIN-SCHED] Margins verified via marginCalculatedAt — guard persisted for today` ✅

**Key files:** `artifacts/api-server/src/cm-kotak-neo-v3.ts`, `lib/db/src/schema/schema.ts`, `artifacts/mentors-world/src/pages/settings.tsx`



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

### [MILESTONE] Margin Calc Time + Daily Fit Check — verified 2026-05-11

**Task:** #247 — Margin Calc Time + Daily Fit Check

**What changed:** Moved `calculatePlanMargins` out of the periodic scrip refresh cycle into a dedicated 09:12 IST daily scheduler. Added a 09:15 IST daily fit check that writes `daily_strategy_fit` audit rows per plan per UCC and activates/pauses plans (autoResume=true plans only). Both times are configurable from the Settings UI.

**Key files:**
- `artifacts/api-server/src/cm-kotak-neo-v3.ts` — added `scheduleMarginCalc`, `scheduleFitCheck`, `runDailyFitCheck`, `runMarginCalcForAllBrokers`, `runAndRescheduleMarginCalc`, `runAndRescheduleFitCheck`; `startCapitalManager` calls both schedulers on startup
- `artifacts/api-server/src/scrip-sync-scheduler.ts` — all 6 periodic `calculatePlanMargins` call sites removed (intraday Phase A/B, daily timeout Phase A/B, daily interval Phase A/B); fault-recovery paths kept their calls via dynamic import
- `lib/db/src/schema/schema.ts` — `dailyStrategyFit` table added
- `artifacts/api-server/src/storage.ts` — `upsertDailyStrategyFit`, `getDailyStrategyFitByDate`, `getDailyStrategyFitByUcc` added to IStorage + DatabaseStorage
- `artifacts/api-server/src/index.ts` — seeds `margin_calc_time="09:12"` and `fit_check_time="09:15"` settings
- `artifacts/mentors-world/src/pages/settings.tsx` — two new time-input UI blocks for both configurable times; "Effective immediately when saved"
- `artifacts/api-server/src/routes/broker-routes.ts` — `GET /api/admin/fit-log?date=YYYY-MM-DD&ucc=` route added

**How it works:**
- **Restart-safe guard (source of truth)**: `isMarginsCalculatedToday(storage)` checks primary broker's active/deployed plans for today's IST date in `marginCalculatedAt`. Fast cache: `margin_calc_last_run` settings key checked first (O(1)); falls through to full plan scan only on cache miss. Guard key only persisted after verified calc (at least one plan updated today). `fit_check_last_run` settings key is the guard for fit check.
- **Startup catch-up**: If it's past the scheduled time and the guard has not fired today, `setImmediate` fires the calc/check once, then schedules for tomorrow.
- **Margin→fit chain (catch-up only)**: 30s after margin calc completes, chain checks: (a) fit check already ran today → skip; (b) `fit_check_time` is still in future → skip (scheduler handles it); (c) `fit_check_time` already past and not yet run → chain fires as catch-up. Primary fit-check trigger is always `scheduleFitCheck()` at `fit_check_time`.
- **Fit allocation algorithm**: Plans ranked by `rank` ASC (nulls last). A `remaining` budget starts at `availableCapital` (Infinity if no snapshot). Each plan is compared against `remaining`; if `remaining >= effectiveMargin`, plan is `fit=true` and `remaining -= effectiveMargin`. Unfit plans do NOT reduce `remaining` — a large unfit plan cannot block later smaller plans.
- **Plan scope**: active + deployed plans, plus paused plans with `autoResume=true`. Manually-paused plans (`autoResume=false`) excluded.
- **Config effective immediately**: saving `margin_calc_time` or `fit_check_time` in Settings triggers dynamic import + reschedule without server restart.

**Diagnostic — if this breaks, check:**
1. Startup logs must show `[MARGIN-SCHED] Already ran today — next margin calc at 09:12 IST tomorrow` OR `[MARGIN-SCHED] Past 09:12 IST — firing margin calc immediately (startup catch-up)`. If firing repeatedly, the DB guard key `margin_calc_last_run` is not being persisted (check primary broker flag).
2. `[FIT-CHECK] Next fit check scheduled at 09:15 IST tomorrow` must appear — if missing, `scheduleFitCheck` was not called from `startCapitalManager`
3. `GET /api/admin/fit-log?date=YYYY-MM-DD` returns audit rows — empty means either fit check hasn't fired yet or no connected brokers
4. DB table `daily_strategy_fit` — unique constraint `(date, planId)` ensures idempotent upserts; check with `SELECT * FROM daily_strategy_fit ORDER BY created_at DESC LIMIT 20`
