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

### [MILESTONE] Fix expiry multiplier, paused plan filter, IST roll — verified 2026-05-12

**Task:** #254 — Fix three expiry-multiplier bugs: hardcoded 1.5×, wrong plan filter, IST roll

**What changed:** Three independent bugs fixed. (1) Frontend capital gating no longer hardcodes 1.5× on expiry day — it now reads `expiryMultiplier` from `index_margin_settings` per index (NIFTY=1.25). (2) `calculatePlanMargins` and `isMarginsCalculatedToday` now include ALL paused plans (regardless of `autoResume`), not just active/deployed. (3) `getTargetExpiry` and `getNextExpiry` now use IST time (UTC+5:30) for the 15:30 market-close roll instead of raw UTC — fixing a 5h window where expiry-day entry orders resolved to the expiring contract instead of next week.

**Key files:**
- `artifacts/mentors-world/src/components/broker-linking.tsx` — added `useQuery` for `/api/index-margin-settings`; built `multiplierByIndex` map; replaced `est * 1.5` with `est * (multiplierByIndex.get(ticker) ?? 1.25)`; updated "1.5x expiry" label to show actual schema value; added `IndexMarginSetting` import
- `artifacts/api-server/src/cm-kotak-neo-v3.ts` — `calculatePlanMargins` filter: added `|| p.deploymentStatus === "paused"`; `isMarginsCalculatedToday` guard: same addition, renamed `active` → `plansToCheck`; `refreshAllCapital` filter left unchanged (correct: `active || deployed` only)
- `artifacts/api-server/src/option-symbol-builder.ts` — both `getNextExpiry` [OSB-2] and `getTargetExpiry` [OSB-3] locked blocks: replaced `now.getHours()/getMinutes()` (UTC) with `istNow.getUTCHours()/getUTCMinutes()` where `istNow = new Date(Date.now() + 5.5 * 3600 * 1000)`

**How it works:**
- **Expiry multiplier**: frontend `fundsByPlan` builds `Map<indexName, expiryMultiplier>` from the `/api/index-margin-settings` response. On expiry day, `gatingMargin = est * multiplierByIndex.get(ticker) ?? 1.25`. The label dynamically shows `(1.25x expiry)` or whatever the schema value is.
- **Paused plan margin**: `autoResume` governs fit-check automation only. All non-draft plans need current margin figures — a paused plan (even `autoResume=false`) needs margin for the user to see what funds it requires before manually resuming. `draft` plans are still excluded (no `tradeParams`).
- **IST roll**: `Date.now() + 5.5 * 3600 * 1000` gives the current UTC millisecond interpreted as IST wall-clock time. `getUTCHours()` on that value reads IST hours correctly without any timezone locale dependency.

**Diagnostic — if this breaks, check:**
1. Capital gating label: open Dashboard → find a plan with `isExpiryMargin=true` → label should show `(1.25x expiry)` not `(1.5x expiry)` — if still 1.5x, `/api/index-margin-settings` fetch is failing or `multiplierByIndex.get(ticker)` key mismatch (check `p.ticker` vs `ims.indexName` casing)
2. Paused plan margin: run `SELECT name, deployment_status, estimated_margin, margin_calculated_at FROM strategy_plans WHERE deployment_status='paused';` — after next margin calc, all paused plans should have today's IST date in `margin_calculated_at`
3. IST roll: on any expiry day between 15:30–20:30 IST, a new order should resolve to next week's contract — `[TE]` logs will show the symbol with next-week expiry date

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

### [MILESTONE] TE capital gating reads expiryMultiplier from DB — verified 2026-05-12

**Task:** #256 — Fix TE capital gating hardcoded 1.5× expiry multiplier

**What changed:** The Trade Executor pre-flight loop (PFL) no longer hardcodes `estimatedMargin * 1.5` on expiry day. It now reads `expiryMultiplier` from `index_margin_settings` per index (NIFTY = 1.25 in production) and applies that value, matching what the frontend capital gating display already does after #254.

**Key files:**
- `artifacts/api-server/src/te-kotak-neo-v3.ts:357-365` — pre-loads `getAllIndexMarginSettings()` into `expiryMultiplierByIndex: Map<string, number>` once per webhook signal, before the per-UCC group loop
- `artifacts/api-server/src/te-kotak-neo-v3.ts:402-412` — E9 block: replaced `estimatedMargin * 1.5` with `estimatedMargin * expiryMult` where `expiryMult = expiryMultiplierByIndex.get(plan.ticker) ?? 1.25`; log message updated to show actual multiplier value

**How it works:** On each incoming webhook signal, `getAllIndexMarginSettings()` is called once to fetch all index rows. A `Map<indexName, number>` is built. For each plan in the PFL loop, `plan.ticker` (e.g. `"NIFTY"`) is looked up in the map. If found, that multiplier is used; if not, 1.25 (schema default) is the fallback. The gating comparison and log message both reflect the actual value: `(1.25x expiry)` instead of the old `(1.5x expiry)`.

**Diagnostic — if this breaks, check:**
1. On expiry day, `[PFL] ⛔` log must show `(1.25x expiry)` not `(1.5x expiry)` when a plan is skipped
2. On expiry day, successful plans should consume `estimatedMargin × 1.25` from `remaining` — check by comparing `remaining` before and after a plan fires
3. If plans are incorrectly skipped on expiry day, `SELECT index_name, expiry_multiplier FROM index_margin_settings WHERE index_name = 'NIFTY'` — confirm value is as configured
4. If `expiryMultiplierByIndex` is empty (all plans fall back to 1.25), check `storage.getAllIndexMarginSettings()` — table may be empty or DB unreachable at signal time

### [MILESTONE] Expiry Day badge on broker-linking strategy card — verified 2026-05-12

**Task:** #257 — Expiry Day badge on strategy card

**What changed:** The strategy card in the Broker Linking view now shows an orange "Expiry Day" badge inline with the "Margin Amt" row whenever `plan.isExpiryMargin = true`. Previously the badge only appeared in the Capital Gating Status table in Settings.

**Key files:**
- `artifacts/mentors-world/src/components/broker-linking.tsx:1107-1109` — added `{plan.isExpiryMargin && <Badge ...>Expiry Day</Badge>}` directly after the Margin Amt span, matching the exact className from the Settings table badge (`bg-orange-500/20 text-orange-400 border-orange-400/30`)

**How it works:** `plan.isExpiryMargin` is a boolean column on `strategy_plans` (added in Task #251) that the margin calc sets to `true` when it runs on an expiry day. The flag persists in the DB until the next margin calc. The badge renders when the flag is true and the plan has an estimated margin — no new queries.

**Diagnostic — if this breaks, check:**
1. Badge missing on expiry day → check `SELECT is_expiry_margin, margin_calculated_at FROM strategy_plans WHERE name ILIKE '%nifty%'` — if `false`, margin calc ran before expiry day or on a non-expiry day
2. Badge shows on non-expiry day → `is_expiry_margin` is stale from a previous expiry — will clear on next daily margin calc

### [MILESTONE] Fix Recalculate Margins button silently skipping — verified 2026-05-12

**Task:** #258 — Fix recalculate-margins endpoint skipping non-primary broker

**What changed:** The "↻ Recalculate" button was calling `calculatePlanMargins` without `{ skipPrimaryGuard: true }`. That guard exits immediately if the broker config is not `isPrimary`, returning silently while the endpoint still responded `{ success: true }`. The toast showed "Margins recalculated" but nothing happened. One-line fix: pass `{ skipPrimaryGuard: true }` in the endpoint since it's an explicit admin action targeting a specific broker.

**Key files:**
- `artifacts/api-server/src/routes/broker-routes.ts:164` — added `{ skipPrimaryGuard: true }` to `calculatePlanMargins` call in `POST /api/broker-configs/:id/calculate-margins`

**How it works:** `skipPrimaryGuard: true` tells `calculatePlanMargins` to skip the `!brokerConfig.isPrimary` early-return and run the full margin calc for whichever broker was passed. The daily scheduler already used this flag; the manual endpoint now does too.

**Diagnostic — if this breaks, check:**
1. After clicking Recalculate, server logs must show `[MARGIN-CALC] Calculating margins for N plan(s)` — if "Skipping — not primary broker" appears instead, the flag is missing again
2. `SELECT estimated_margin, margin_calculated_at FROM strategy_plans` — `margin_calculated_at` should update to within seconds of the button click

### [MILESTONE] Fix neutral legs double-entry on explicit ENTRY@neutralLegs — verified 2026-05-13

**Task:** #259 — Fix neutral legs double-entry on explicit ENTRY@neutralLegs

**What changed:** Added a one-line guard `&& ctx.resolvedBlockType !== "neutralLegs"` to the Task #112 auto-seed condition in `buildEntryBasket`. Without this guard, when MC config `ea52c439` dispatches `ENTRY@neutralLegs` explicitly, `ctx.legs` and `ctx.neutralLegs` both contain the same neutral legs — so the basket was built with 4 items instead of 2, placing 2× lots at the broker. Confirmed in production: every fresh BUY_DT and BUY_UT entry since Task #112 was deployed created 4 DB records and 2 lots each in the Kotak position book.

**Key files:**
- `artifacts/api-server/src/te-kotak-neo-v3.ts:1135` — added `&& ctx.resolvedBlockType !== "neutralLegs"` to the `buildEntryBasket` auto-seed condition; updated LOCKED BLOCK comment [4] with Task #259 annotation explaining the guard

**How it works:** `selectLegs(tradeParams, "neutralLegs")` returns the neutral legs array when `resolvedBlockType === "neutralLegs"`. The Task #112 auto-seed also pushes `ctx.neutralLegs` (same array). The guard prevents the auto-seed from firing when the block type is already `neutralLegs` — `ctx.legs` alone handles the entry. Fresh-session reversal behavior (Task #112) is unaffected: reversals always resolve to `uptrendLegs`/`downtrendLegs`, not `neutralLegs`, so the auto-seed still fires correctly on those paths.

**Diagnostic — if this breaks, check:**
1. On next fresh BUY_DT or BUY_UT: `SELECT block_type, trading_symbol, COUNT(*) FROM strategy_trades WHERE plan_id='9c331a6a-...' AND DATE(created_at)=TODAY GROUP BY 1,2` — neutralLegs should show COUNT=1 per symbol, not 2
2. `[TE] Fresh session: auto-seeding N neutral leg(s)` log must NOT appear when `blockType=neutralLegs` in PFL; it SHOULD appear on fresh-session reversal (SELL_DT+BUY_UT with no open positions)
3. Kotak position book: neutral legs should show 1 lot each (65 qty), not 2 lots (130 qty)

### [MILESTONE] Fill price REST retry — schema-based configurable settings — verified 2026-05-15

**Task:** #260 — Wire fill-price REST retry to Trade Execution settings

**What changed:** `getFillPrice`'s REST fallback no longer has hardcoded retry behaviour (1 retry, 1000ms delay). It now reads two new `app_settings` keys — `fill_price_rest_retry_count` (default 3) and `fill_price_rest_retry_delay_ms` (default 2000ms) — seeded at startup in `index.ts` and configurable from the Trade Execution section of the Settings page. Both call sites of `getFillPrice` now pass `storage` so the settings can be read.

**Key files:**
- `artifacts/api-server/src/te-kotak-neo-v3.ts:53` — `getFillPrice` signature gained `storage: IStorage` param; REST fallback block (lines ~75–130) replaced hardcoded single-retry with a settings-driven loop logging `[TE] REST fill retry N/M for {orderId} — waiting {delay}ms`
- `artifacts/api-server/src/te-kotak-neo-v3.ts:918,1576` — both call sites updated to pass `storage` as first argument
- `artifacts/api-server/src/index.ts:250-253` — seeded `fill_price_rest_retry_count="3"` and `fill_price_rest_retry_delay_ms="2000"` with `if (!existing)` guards
- `artifacts/mentors-world/src/pages/settings.tsx` — added queries, state, useEffects, mutations, and two UI blocks ("Fill Price REST Retry Attempts" and "Fill Price REST Retry Delay") in the Trading Execution card, following the identical pattern as existing retry settings

**How it works:** On each HSI timeout, `getFillPrice` reads the two settings keys once via `storage.getSetting()`. It then loops up to `retryCount` times, waiting `retryDelayMs` ms between each attempt. The first attempt fires immediately (no pre-delay). If any attempt returns a non-empty order history with a positive fill price, it returns that fill price and exits early. If all attempts are exhausted, ₹0 is returned as before (MTM guard skips those legs). Default 3 × 2000ms = up to 6 seconds of REST polling after HSI timeout — well inside Kotak's typical 2–5s history lag.

**Diagnostic — if this breaks, check:**
1. On HSI timeout, logs must show `[TE] WARN: HSI fill confirmation timeout for {orderId} — falling back to REST getOrderHistory` followed by `[TE] REST fill retry 2/3 for {orderId} — waiting 2000ms` (attempt 1 is immediate, retries log from attempt 2)
2. If ₹0 is stored despite a valid fill, check `SELECT value FROM app_settings WHERE key IN ('fill_price_rest_retry_count','fill_price_rest_retry_delay_ms')` — if rows are missing, the seed in `index.ts` did not run (restart server)
3. Settings UI: General Settings → Trading Execution → "Fill Price REST Retry Attempts" and "Fill Price REST Retry Delay" fields should show 3 and 2000 respectively after first server boot

### [MILESTONE] tradedStatus field — entry/exit hooks, margin skip, UI badge — verified 2026-05-15

**Task:** #240 — Add `tradedStatus` to `strategy_plans`; wire TE entry/exit; skip margin recalc; show badge

**What changed:** Added `traded_status text NOT NULL DEFAULT 'not_traded'` column to `strategy_plans`. The Trade Executor sets it to `"traded"` on every successful entry basket (both BUY and SELL signal paths), and clears it back to `"not_traded"` when the last open leg closes. The margin calculator skips plans where `tradedStatus === "traded"` to avoid overwriting margin figures while a basket is live. The Broker Linking UI shows a blue "● Traded" or muted "○ Not Traded" indicator inline with each plan's capital gating row, and the capital simulation treats traded plans as always-fitting (no deduction) since their margin is already deployed.

**Key files:**
- `lib/db/src/schema/schema.ts:186` — added `tradedStatus: text("traded_status").notNull().default("not_traded")` to `strategyPlans` pgTable
- `artifacts/api-server/src/te-kotak-neo-v3.ts:1225-1230` — executeBuySignal: replaced `if (awaitingCleanEntry)` block with unconditional `updateStrategyPlan({ tradedStatus: "traded", ...(awaitingCleanEntry ? { awaitingCleanEntry: false } : {}) })`
- `artifacts/api-server/src/te-kotak-neo-v3.ts:1319-1324` — executeSellSignal leg-interchange path: same unconditional entry hook
- `artifacts/api-server/src/te-kotak-neo-v3.ts:1621` — closeTrade exit choke-point: added `tradedStatus: "not_traded"` alongside `awaitingCleanEntry: true` in the `remainingOpen.length === 0` block
- `artifacts/api-server/src/cm-kotak-neo-v3.ts:530-536` — `calculatePlanMargins` filter: `.filter(p => p.tradedStatus !== "traded")` added; skipped plans are logged at `[MARGIN-CALC]`
- `artifacts/mentors-world/src/components/broker-linking.tsx:644-648` — capital simulation: `isTraded = p.tradedStatus === "traded"`, `fits = isTraded || gatingMargin <= remaining`, deduction skipped for traded plans; `isTraded` added to `out` map type
- `artifacts/mentors-world/src/components/broker-linking.tsx:1095-1099` — UI: added "● Traded" (blue) / "○ Not Traded" (muted) badge inline in the capital gating row

**How it works:**
- **Entry**: After `executeLegBasket` returns without error in both BUY and SELL execution paths, a single `updateStrategyPlan` call sets `tradedStatus: "traded"` and conditionally clears `awaitingCleanEntry` in the same DB round-trip. No separate update needed.
- **Exit**: `closeTrade` already calls `updateStrategyPlan({ awaitingCleanEntry: true })` when `remainingOpen.length === 0`. `tradedStatus: "not_traded"` is now included in that same call.
- **Margin skip**: The `plansToCalc` filter chain in `calculatePlanMargins` now has a second `.filter()` that drops any plan with `tradedStatus === "traded"`, preventing overwrite of a live basket's margin figure.
- **Capital sim**: Traded plans contribute `fits=true` but do not reduce `remaining` — the broker's capital already reflects the deployed margin, so simulating a deduction would incorrectly block lower-ranked plans.

**Diagnostic — if this breaks, check:**
1. After a BUY entry fires: `SELECT traded_status FROM strategy_plans WHERE id='<plan-id>'` must be `"traded"` within seconds
2. After square-off (all legs closed): same query must return `"not_traded"`
3. Margin recalc log: `[MARGIN-CALC] Plan "X" — status=Traded, skipping recalculation` must appear for any plan currently in trade during the daily 09:12 run
4. UI: Broker Linking page → any plan with an active basket must show "● Traded" (blue) in its capital row; all others "○ Not Traded"
5. If `tradedStatus` column is missing after deploy: run `pnpm --filter @workspace/db run push` — the column has `DEFAULT 'not_traded'` so it is safe to add to a populated table

### [MILESTONE] Recalculate button also refreshes Available Funds — verified 2026-05-15

**Task:** #261 — Recalculate button also refreshes Available Funds

**What changed:** Clicking ↻ Recalculate now atomically recalculates margins AND refreshes the Available Funds capital snapshot in one action. Previously the user had to separately hit the funds refresh button to see updated capital after recalculating margins.

**Key files:**
- `artifacts/api-server/src/routes/broker-routes.ts:164-167` — after `calculatePlanMargins` completes, calls `refreshCapitalForBrokerConfig(storage, config.id)` and returns the snapshot in the response body alongside `{ success: true }`
- `artifacts/mentors-world/src/components/broker-linking.tsx:597-598` — `onSuccess` of `recalculateMarginMutation` now invalidates both `["/api/strategy-plans"]` (margin figures) and `["/api/broker-capital-snapshots"]` (Available Funds)

**How it works:** The backend does the capital refresh synchronously before responding, so by the time the frontend mutation resolves, the DB already holds a fresh snapshot. The two `invalidateQueries` calls then trigger React Query refetches for both data sets, causing the UI to display updated margin figures and Available Funds without any further user action. The standalone funds-refresh button is unchanged.

**Diagnostic — if this breaks, check:**
1. After clicking Recalculate, server logs must show `[CAPITAL-MGR] Manual refresh UCC X: ₹N` immediately after the `[MARGIN-CALC]` lines — if missing, `refreshCapitalForBrokerConfig` call was removed from the endpoint
2. Available Funds figure in Broker Linking must update within 1-2s of the toast — if still stale, check that `queryKey: ["/api/broker-capital-snapshots"]` invalidation is present in `onSuccess`
3. If the broker is not connected, `refreshCapitalForBrokerConfig` returns `reason: "broker not connected"` — margins are still recalculated; only the capital figure stays as-is (expected behaviour)

### [MILESTONE] Auto-refresh strategy cards on scheduled margin calc — verified 2026-05-15

**Task:** #262 — Auto-refresh strategy cards on scheduled margin calc

**What changed:** When the 09:12 IST scheduled margin calc fires (or the 09:15 fit check), connected browser tabs on the Broker Linking page now automatically refresh their strategy cards — margin figures, "Date: … IST" timestamps, and Available Funds — without any page reload. A "Margins refreshed" toast appears after the margin calc event so the user knows fresh data has arrived.

**Key files:**
- `artifacts/api-server/src/cm-kotak-neo-v3.ts:32` — added `import { broadcast } from "./sse-hub"`
- `artifacts/api-server/src/cm-kotak-neo-v3.ts:719-720` — in `runAndRescheduleMarginCalc`, emits `broadcast("margin_calc_complete", { t })` immediately after `runMarginCalcForAllBrokers` returns
- `artifacts/api-server/src/cm-kotak-neo-v3.ts:758-759` — in the 30s chain catch-up path inside `runAndRescheduleMarginCalc`, emits `broadcast("fit_check_complete", { t })` after the chained `runDailyFitCheck`
- `artifacts/api-server/src/cm-kotak-neo-v3.ts:828-829` — in `runAndRescheduleFitCheck` (scheduled path), emits `broadcast("fit_check_complete", { t })` after `runDailyFitCheck`
- `artifacts/mentors-world/src/components/broker-linking.tsx:529-562` — added `useEffect` in `BrokerLinking` that opens an `EventSource` to `/api/sse/feed`, listens for `margin_calc_complete` (invalidates plans + capital, shows toast) and `fit_check_complete` (invalidates plans + capital silently), with 5s reconnect on error and cleanup on unmount

**How it works:**
- The existing `broadcast()` hub in `sse-hub.ts` fans out SSE events to all connected clients over the `/api/sse/feed` endpoint
- `margin_calc_complete` fires once per scheduled margin calc run (after `runMarginCalcForAllBrokers` returns)
- `fit_check_complete` fires from both the scheduled path (`runAndRescheduleFitCheck`) and the 30s chain catch-up path inside `runAndRescheduleMarginCalc`
- On either event, React Query invalidates `["/api/strategy-plans"]` and `["/api/broker-capital-snapshots"]`, triggering refetches that re-render the strategy card margin amounts, timestamps, and Available Funds
- The `marginCalculatedAt` field is already included in the plans API response, so the "Date: … IST" label updates automatically from the refreshed plan data

**Diagnostic — if this breaks, check:**
1. Server logs at 09:12 IST must show `[MARGIN-SCHED] … running calculatePlanMargins` followed by no `broadcast` error — if missing, `import { broadcast }` may have been removed from cm-kotak-neo-v3.ts
2. In browser DevTools → Network → `/api/sse/feed` (EventStream tab): after 09:12 IST, an event `margin_calc_complete` should appear in the stream
3. Strategy card "Date: … IST" should update to today's date within seconds of the SSE event — if still showing yesterday's date, the `invalidateQueries` for `/api/strategy-plans` is not firing (check the `addEventListener("margin_calc_complete")` call in broker-linking.tsx)
4. `fit_check_complete` fires from two places — the scheduled `runAndRescheduleFitCheck` and the chain inside `runAndRescheduleMarginCalc`; if one is missing, only one path emits

### [MILESTONE] Keep legs intact on config change — verified 2026-05-15

**Task:** #263 — Keep legs intact on config change

**What changed:** Changing the Parent Configuration dropdown in the Trade Planning plan form (create or edit) no longer wipes execution legs, stoploss, profit target, trailing SL, or time logic. Users can now seamlessly switch between configs (e.g. 3-min vs 5-min timeframe variants of the same strategy) without rebuilding legs from scratch.

**Key files:**
- `artifacts/mentors-world/src/components/trade-planning.tsx:324` — `onValueChange` handler on the Parent Configuration `Select` reduced to `setConfigId(v)` only; all seven downstream reset calls (`setUptrendLegs([])`, `setDowntrendLegs([])`, `setNeutralLegs([])`, `setStoploss(...)`, `setProfitTarget(...)`, `setTrailingSL(...)`, `setTimeLogic(...)`) removed

**How it works:** Legs, stoploss, and time logic are instrument-agnostic — they store strike type, direction, quantity, and risk values, none of which are config-specific. The existing `useEffect` (line 113–119) already handles the only things that genuinely need to refresh on config change: indicator badge selections (reset to new config's signal list) and exchange/ticker auto-fill (when blank). No other state needs resetting.

**Diagnostic — if this breaks, check:**
1. Open New Plan → select Config A → add legs → change to Config B → legs must still be present
2. Open Edit Plan → change config → legs must be preserved and save correctly with the new configId
3. Closing the dialog (Cancel or X) must still fully reset legs — `closeDialog()` is untouched and still calls all reset setters
