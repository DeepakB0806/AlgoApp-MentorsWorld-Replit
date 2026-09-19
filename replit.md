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

## Gotchas

- Do NOT run `pnpm dev` at workspace root — use `restart_workflow` instead
- `pnpm --filter @workspace/api-server run typecheck` may show legacy TS errors — acceptable per task scope
- Auth requires `REPLIT_DEPLOYMENT`, `REPL_ID`, `ISSUER_URL`, `SESSION_SECRET` env vars for Replit Auth; TOTP/email auth works without them
- DB push requires drizzle-kit; run `pnpm install` first if it fails with MODULE_NOT_FOUND

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details

## Frontend UI layout crosscheck

When changing any frontend page, card, table, text block, dialog, sheet, preview, sticky header, Tailwind breakpoint, or authenticated route:

- Keep protected pages inside `AuthenticatedPageShell`; it owns the dynamic viewport height, vertical scrolling, overscroll behavior, background, and main scroll container.
- Do not introduce fixed-height clipping or page-level `overflow-hidden` to solve a local layout issue.
- Check narrow and wide layouts for wrapping, stacking, horizontal overflow, and intentional inner scrolling for tables, logs, sheets, and previews.
- Run `pnpm --filter @workspace/mentors-world run test:ui-layout`, `pnpm --filter @workspace/mentors-world run typecheck`, and the correctly configured production build.
- For authenticated browser checks, run `LAYOUT_TEST_STORAGE_STATE=/path/to/super-admin-storage-state.json LAYOUT_TEST_BASE_URL=http://127.0.0.1:18772 pnpm --filter @workspace/mentors-world run test:layout:browser`.
- The browser check requires a Playwright-compatible storage-state JSON for a super-admin test session; never commit credentials or weaken production authentication to create one. If it is unavailable, report that limitation explicitly rather than treating the public landing page as authenticated verification.
- For the full release gate, run `pnpm run test:regression-gates`. This always runs auth, Kotak compatibility, and UI source checks. Add `REGRESSION_GATE_BROWSER=required AUTH_LOGOUT_TEST_STORAGE_STATE=/path/to/disposable-local-session.json AUTH_LOGOUT_TEST_BASE_URL=http://127.0.0.1:18772` to make authenticated layout and local-logout browser checks blocking.

## Milestones

> Milestones before 2026-05-13 archived to `.local/milestone-history.md`

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

### [MILESTONE] TSL wired into live trade execution — verified 2026-05-18

**Task:** #270 — Fix TSL not activating for trades opened during a live session

**What changed:** Two gaps closed. TSL was completely inactive for any trade opened after server startup. The 2026-05-18 production incident (user forced to manually square off NIFTY50 OTM 5 STRATEGY) was caused by both bugs firing together.

**Bug 1 (CRITICAL):** `executeLegBasket` in the TE promoted trades to `status="open"` but never called `registerNewTrail`. The in-memory TSL engine (`trailsBySymbol` map) only rehydrates at startup from DB. Every trade opened during a live session was invisible to TSL.

**Bug 2 (SECONDARY):** `startWsGateway` filtered `openTrades.filter(t => t.productType === "NRML")` before seeding `subscriptions`. MIS open trades were silently excluded — HSM sent zero subscriptions for them on restart, so no live ticks flowed.

**Key files:**
- `artifacts/api-server/src/te-kotak-neo-v3.ts:33-34` — added imports: `hsmSubscribe` from hsm, `registerNewTrail` from tsl
- `artifacts/api-server/src/te-kotak-neo-v3.ts:1135-1143` — after basket success, loop `finalTrades`: call `registerNewTrail(t)` when `trailingStep > 0`, call `hsmSubscribe(t.tradingSymbol)` for all
- `artifacts/api-server/src/hsm-kotak-neo-v3.ts:524-530` — removed NRML filter; all open trades pre-subscribed at startup

**Verified at restart:** `[HSM] Pre-subscribed 1 open trade symbol(s)` (was `NRML symbols`). `[TSL] TSL Engine started` visible.

**Diagnostic — if TSL still silent after a trade opens:**
1. `[TSL] Registered trail for {symbol} ...` must appear within seconds of order fill — if missing, check `openTrade.trailingStep` value in DB (`SELECT trading_symbol, trailing_step, tsl_activate_at FROM strategy_trades WHERE status='open'`)
2. TSL fields only written when `productType = NRML` — MIS trades still have null `trailingStep` → TSL won't register (separate task #271)
3. `[HSM] Pre-subscribed N open trade symbol(s)` at startup — N must match count of open trades

### [MILESTONE] HSI rejection wired into fill price pipeline — verified 2026-05-18

**Task:** #268 — Wire HSI rejection into fill price pipeline

**What changed:** Three connected fixes so a Kotak RMS rejection (API-accepted but internally rejected) no longer creates an orphan open trade that triggers a spurious square-off.

1. **`orderRejectRegistry` added to HSI** — mirrors `orderConfirmRegistry`. `registerOrderRejectCallback`/`deregisterOrderRejectCallback` exported. The existing HSI `rejected`/`cancelled` event handler now calls the reject callback immediately when it fires.
2. **`getFillPrice` races confirm + reject** — registers both callbacks in the HSI race block. On rejection, resolves immediately with `{ rejected: true, rejReason }` — no 10s timeout, no REST round-trip. Returns `{ fillPrice: 0, status: "REJECTED" }` at once.
3. **TE rejection branch extended to `"UNKNOWN"`** — when both HSI and REST fail (status="UNKNOWN"), the order now enters the rejection branch instead of falling through to a `status="open"` DB write. Prevents orphan trades even when HSI is down and REST is also unreachable.

**Root cause of 2026-05-18 incident:** NIFTY 23450 CE SELL was RMS-rejected. HSI fired a rejection event but it had no path back to `getFillPrice`. That callback timed out → REST also failed → `status="UNKNOWN"` → trade written as open → square-off bought the CE at ₹108.15 → user had to manually sell at ₹101.95 (₹403 loss).

**Key files:**
- `artifacts/api-server/src/hsi-kotak-neo-v3.ts:58-66` — `orderRejectRegistry`, `registerOrderRejectCallback`, `deregisterOrderRejectCallback`
- `artifacts/api-server/src/hsi-kotak-neo-v3.ts:338-349` — rejection event handler calls `rejectCb(rejRsn)`
- `artifacts/api-server/src/te-kotak-neo-v3.ts:32` — import of new reject callbacks
- `artifacts/api-server/src/te-kotak-neo-v3.ts:57-81` — `getFillPrice` races both callbacks; early return on reject
- `artifacts/api-server/src/te-kotak-neo-v3.ts:971` — rejection branch condition adds `|| orderStatus === "UNKNOWN"`

**Diagnostic — if this breaks, check:**
1. On any rejected entry order: `[TE] Order XXXXXXXX REJECTED via HSI: <reason>` must appear in logs within < 1s of order placement — no 10s timeout log
2. `[HSI] Order REJECTED: <orderId> reason="..."` must appear first (HSI fires the event)
3. No orphan open trade in DB: `SELECT symbol, status, price FROM strategy_trades WHERE status='open' AND price=0` should be empty after any rejection
4. If HSI is down and REST also fails → `status="UNKNOWN"` → rejection branch fires → `[ORDER] N/A → UNKNOWN | symbol: ...` in PFL → no DB write as open

### [MILESTONE] Deploy form pre-fill + summary chip read from schema columns — verified 2026-05-17

**Tasks:** #265 (deploy form pre-fill) + #266 (summary chip schema reads)

**What changed:** Two broker-linking.tsx cleanups after #264 promoted SL/PT/TSL to schema columns.

(#265) `initDeployConfig` was pre-filling the deploy form stoploss/profitTarget from `plan.deployStoploss || baseSL` and `plan.deployProfitTarget || basePT`. If `deploy_stoploss` was stale (plan SL changed in Trade Planning after last deployment), the form opened with the old value. Now uses `baseSL` / `basePT` directly — both already read from `stoplossValue` / `profitTargetValue` schema columns with JSON fallback.

(#266) The collapsed strategy summary chip and the expanded config panel SL/PT chips were still reading `tp.stoploss.enabled` / `tp.stoploss.value` / `tp.stoploss.mode` from the JSON blob. Updated to `plan.stoplossEnabled ?? tp.stoploss?.enabled` etc., matching the schema-column-first pattern used everywhere else in the file after #264.

**Key files:**
- `artifacts/mentors-world/src/components/broker-linking.tsx:840-841` — `initDeployConfig`: `stoploss: baseSL`, `profitTarget: basePT` (removed stale `plan.deployStoploss` / `plan.deployProfitTarget` fallback)
- `artifacts/mentors-world/src/components/broker-linking.tsx:1088` — summary chip: schema-column reads with JSON fallback
- `artifacts/mentors-world/src/components/broker-linking.tsx:1254-1255` — expanded config panel SL/PT chips: schema-column reads with JSON fallback

**Diagnostic:**
1. Open Broker Linking → click Deploy on any plan → SL field should show the current `stoplossValue` (not an older deployment's override)
2. Collapsed summary chip should show `SL: N` reading from `plan.stoplossValue`
3. TSL chip (line 1256) still reads from `tp.trailingSL` JSON — intentional, `tslChipLabel()` needs the full config object and JSON is always in sync

### [MILESTONE] Fix two silent storage.ts bugs — verified 2026-05-17

**Task:** #267 — Fix two silent storage bugs

**What changed:** Three `lt()` comparisons against text-typed `createdAt` columns now pass `.toISOString()` strings instead of `Date` objects (fixes TS2769 and ensures correct lexicographic comparison in Postgres). `addProcessFlowLogToDB` now generates and injects `id: randomUUID()` at insert time — previously every process flow log insert was silently failing because the PK column has no DB default.

**Key files:**
- `artifacts/api-server/src/storage.ts:1078` — `deleteStrategyTradesByPlan`: `cutoff` → `cutoff.toISOString()`
- `artifacts/api-server/src/storage.ts:1096` — `deleteStrategyTradesOlderThan`: `cutoff` → `cutoff.toISOString()`
- `artifacts/api-server/src/storage.ts:1624` — `addProcessFlowLogToDB`: `values(log)` → `values({ ...log, id: randomUUID() })`

**How it works:** All `createdAt` columns in `strategy_trades` store ISO-8601 strings (e.g. `"2026-05-17 14:16:20"`). Passing a JS `Date` to Drizzle's `lt()` would cause a type error and potentially wrong results. `.toISOString()` produces a comparable string. For process flow logs: `process_flow_logs.id` is a `varchar(36) PRIMARY KEY` with no `DEFAULT` — Postgres would reject any insert without an explicit id value, silently eating the error in the calling code's try/catch.

**Diagnostic — if this breaks, check:**
1. `SELECT COUNT(*) FROM process_flow_logs` — should grow after any trade signal fires; if still zero, check `addProcessFlowLogToDB` call sites for a try/catch swallowing errors
2. Data retention logs: after the daily job runs, `[DATA-RETENTION]` should show a non-zero deleted count if old trades exist
3. `pnpm --filter @workspace/api-server run typecheck 2>&1 | grep storage.ts` should return empty (no matches)

### [MILESTONE] SL / PT / TSL promoted to strategy_plans schema columns — verified 2026-05-17

**Task:** #264 — Promote SL, Profit Target, and TSL to schema columns

**What changed:** Stoploss, profit target, and trailing SL configuration moved from the `trade_params` JSON blob to 12 dedicated columns on `strategy_plans`. The Broker Linking card now reads `stoplossValue` directly (fixing the stale `deploy_stoploss` display bug). MTM monitor and Trade Executor read from schema columns with JSON fallback for any unmigrated plans. A one-time startup backfill migrated all 6 existing plans.

**Key files:**
- `lib/db/src/schema/schema.ts:187-199` — 12 new columns added: `stoploss_enabled/mode/value`, `profit_target_enabled/mode/value`, `trailing_sl_enabled/type/activate_at/lock_profit_at/when_profit_increase_by/increase_tsl_by`
- `artifacts/api-server/src/index.ts:258-290` — startup backfill: scans plans where `stoplossValue IS NULL`, parses `trade_params`, writes all 12 columns
- `artifacts/mentors-world/src/components/trade-planning.tsx:261-273` — `handleSave` payload now includes all 12 schema fields
- `artifacts/mentors-world/src/components/broker-linking.tsx:822-853` — `initDeployConfig` reads schema columns first; `effectiveSL`/`effectivePT` use `stoplossValue`/`profitTargetValue` (no longer `deployStoploss`)
- `artifacts/api-server/src/mtm-monitor.ts:84-103` — reads `stoplossEnabled/Value/Mode` and `profitTargetEnabled/Value/Mode` from plan columns; falls back to JSON only if schema values are 0/false
- `artifacts/api-server/src/te-kotak-neo-v3.ts:1053-1070` — reads TSL config from `plan.trailingSLEnabled/Type/ActivateAt/…`; falls back to JSON only if schema column is null

**How it works:**
- **Backfill guard**: `stoplossValue IS NULL` identifies pre-migration plans (all rows populated with defaults on db:push, so `== null` in JS catches both null and undefined). Backfill runs once on startup; subsequent restarts skip (all plans will have non-null `stoplossValue` after first run).
- **Read priority**: schema column → JSON fallback. For MTM monitor: if `stoplossEnabled===false && value===0`, falls through to JSON parse for backward compat. For TE: if `trailingSLEnabled` column is null (truly unmigrated), reads JSON.
- **Display fix**: `effectiveSL` badge on Broker Linking card now shows `plan.stoplossValue` (source of truth from Trade Planning save) rather than `plan.deployStoploss` (was stale in production: 500 vs actual 1200).

**Diagnostic — if this breaks, check:**
1. On startup: `[STARTUP] #264 backfill: migrated N plan(s)` or `already have SL/PT/TSL schema columns` — if missing, the backfill block errored; check `[STARTUP] #264 backfill error:`
2. After saving a plan in Trade Planning, `SELECT stoploss_enabled, stoploss_value, trailing_sl_enabled FROM strategy_plans WHERE name = '...'` — must reflect the form values
3. Broker Linking SL badge: if still shows stale value, check `plan.stoplossValue` in the `/api/strategy-plans` response — if null, the save didn't include the new fields (check `handleSave` payload)
4. MTM stoploss trigger: if plans with SL stop triggering, `stoplossEnabled` column may be false while JSON has it true — force a save from Trade Planning to re-sync

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

### [MILESTONE] Distinguish UNKNOWN order: session expiry vs genuine rejection — verified 2026-05-18

**Task:** #272 — Distinguish UNKNOWN order status: session expiry vs genuine rejection

**What changed:** When both HSI and REST fill confirmation fail, the system now distinguishes between two causes: (1) session/auth error (orders placed at broker but fill unconfirmed) → trade written as `open` with `price=0` for manual review; (2) genuine order-not-found failure → existing UNKNOWN → rejection branch unchanged. MTM monitor now also skips NFO/BFO legs with `entryPrice === 0` to prevent false SL/PT triggers.

**Key files:**
- `artifacts/api-server/src/te-kotak-neo-v3.ts` — `getFillPrice`: hoisted `restAuthError` variable above `try/catch`; REST retry loop detects auth keywords in error message (session, token, unauthorized, unauthenticated, authentication) → sets `restAuthError` and breaks; after catch, if `restAuthError` is set returns `{ status: "UNCONFIRMED" }` instead of `"UNKNOWN"`. New `UNCONFIRMED` branch before rejection block logs warning and lets execution fall through to basket success path (trade written `open` with `price=0`, `rejectedReason` stores auth error detail).
- `artifacts/api-server/src/mtm-monitor.ts` — sanity guard: after `> 5000` check, added `=== 0` check — skips NFO/BFO legs with zero entry price, preventing false SL/profit-target exits on unconfirmed positions.

**How it works:**
- **Auth detection**: `histResult.error` from `EL.getOrderHistory` is lowercased and checked for auth keywords. If matched → `restAuthError` is set and the retry loop breaks immediately (no point retrying a session error).
- **UNCONFIRMED path**: `getFillPrice` returns `{ fillPrice: 0, status: "UNCONFIRMED", reason: "session_error: ..." }`. The `UNCONFIRMED` block in `executeLegBasket` logs `[TE] WARN: Order XXXXXXXX placed but UNCONFIRMED` and does NOT set `attemptFailed`. Execution continues to `stagedTrade` write (with `price=0` and `rejectedReason = session error message`), then basket success promotes to `status="open"`.
- **MTM guard**: `entryPrice === 0` on NFO/BFO → skip with `WARN: entry price is ₹0 (fill unconfirmed — requires manual review)`. These trades stay open for human review/square-off; no automated exit fires.
- **UNKNOWN unchanged**: non-auth REST failures still reach `return { status: "UNKNOWN" }` → existing rejection branch.

**Diagnostic — if this breaks, check:**
1. On session expiry + order placement: logs must show `[TE] REST fill lookup: session/auth error for XXXXXXXX — "..." — skipping retries` followed by `[TE] WARN: Order XXXXXXXX placed but UNCONFIRMED`
2. Trade must appear in DB as `open` with `price=0` and `rejected_reason` containing `session_error:` — check `SELECT id, status, price, rejected_reason FROM strategy_trades WHERE price = 0`
3. MTM monitor must log `WARN: skipping ... — entry price is ₹0` for the unconfirmed trade — if not, the `=== 0` guard is not firing (check `entryPrice` is actually `0` and not `null`)
4. Genuine REJECTED orders still must NOT create open trades — verify by checking that `status: "REJECTED"` from HSI still enters the rejection branch (HSI rejection path is unchanged at line ~77)

### [MILESTONE] Fix HSI startup log to show correct UCC — verified 2026-05-18

**Task:** #275 — Fix HSI startup log to use correct UCC field from schema

**What changed:** One-line fix — `config.clientId ?? config.id` → `config.ucc ?? config.id` in the HSI startup log.

**Key files:**
- `artifacts/api-server/src/hsi-kotak-neo-v3.ts:489` — log now reads `config.ucc` (schema's `ucc: text("ucc")` column) instead of `config.clientId` (a different Kotak login field)

**How it works:** `config.ucc` is the broker's Unique Client Code stored in `broker_configs.ucc`. It is used consistently everywhere else that identifies a broker by its trading identity. Falls back to `config.id` (internal UUID) only if `ucc` is null.

**Diagnostic:** On startup, logs must show `[HSI] Starting HSI instance for UCC=2KVW9 URL=...` with the actual Kotak UCC, not an internal UUID.

### [MILESTONE] Archive pre-2026-05-13 milestones from replit.md — verified 2026-05-18

**Task:** #276 — Archive older milestones from replit.md to keep it lean

**What changed:** 10 milestone blocks verified before 2026-05-13 (Tasks #251, #253, #254, #256, #257, #258, #245, #247, HSM single-source finding, and Agent skills setup) moved from `replit.md` to `.local/milestone-history.md`. Archive note added immediately above the remaining milestone list under `## Milestones`.

**Key files:**
- `replit.md` — removed 10 pre-2026-05-13 milestone blocks; added `> Milestones before 2026-05-13 archived to \`.local/milestone-history.md\`` note; all retained milestones now live directly under `## Milestones`
- `.local/milestone-history.md` — created (gitignored); holds the 10 archived milestone blocks verbatim

**How it works:** No runtime behaviour changed — documentation reorganisation only. `replit.md` drops from 555 lines to ~370 lines, reducing token load on every future agent session. `.local/` is gitignored so the archive file is workspace-local only.

**Diagnostic — if milestones are missing:**
1. Check `.local/milestone-history.md` — archived entries are there and fully intact
2. `grep "### \[MILESTONE\]" replit.md` — should list 14 entries (2026-05-13 through 2026-05-18)
3. `grep "### \[MILESTONE\]" .local/milestone-history.md` — should list 10 entries (all pre-2026-05-13)

### [MILESTONE] SL / TSL per-lot scaling fix — verified 2026-05-20

**Task:** #278 — SL / TSL per-lot scaling fix

**What changed:** Two bugs fixed where configured "per lot" values were applied at the wrong scale. (1) MTM monitor now multiplies `stoplossValue` and `profitTargetValue` by `plan.lotMultiplier` before the threshold check when mode is "amount" — a plan with `lotMultiplier=3` and SL=₹500 now correctly stops at ₹1,500 total MTM loss. (2) TE now stores TSL amount-type thresholds (`tslActivateAt`, `tslLockProfit`, `tslProfitStep`, `trailingStep`) in per-unit price terms by dividing by `lotSize × leg.lots`, matching the `ltp - entryPrice` unit that `processTick` (locked block) uses for comparison — TSL was previously using raw rupee amounts against per-unit price differences, so it could never activate.

**Key files:**
- `artifacts/api-server/src/mtm-monitor.ts:115-169` — added `lotMultiplier` scaling for amount-mode SL/PT; updated log lines to show `× N lots` annotation when multiplier > 1
- `artifacts/api-server/src/te-kotak-neo-v3.ts:1112-1126` — removed `× lotMult` multiplier; added `tslUnitDivisor = lotSize × tslLegLots` divisor; all four resolved TSL thresholds now stored as per-unit price (₹/unit)

**How it works:**
- **MTM (Bug 1):** `scaledSlValue = stoplossValue × lotMultiplier` (amount mode only); passed to `resolveThreshold` in place of raw value. Percentage mode unaffected — capital already reflects total qty × lotMultiplier.
- **TSL (Bug 2):** For a NIFTY trade (lotSize=65, leg.lots=1), user-configured `tslActivateAt=₹2,000/lot` → stored as `2000/65 = ₹30.77/unit`. `processTick` fires when `ltp - entryPrice ≥ 30.77` (= ₹2,000 profit on 65 qty). `lotMult` cancels out and was removed. The locked block (`processTick`, `registerNewTrail`, `flushDirtyTrails`) has zero edits.

**Diagnostic — if this breaks, check:**
1. MTM SL log must show `threshold=-1000 (amount 500 × 2 lots)` for a plan with `lotMultiplier=2`, SL=₹500 — if still shows `-500`, the `scaledSlValue` computation was removed
2. On new trade entry (NRML, amount TSL), `SELECT tsl_activate_at FROM strategy_trades WHERE id='...'` must be a small decimal (e.g., 30.77 for NIFTY ₹2000 config), not a large rupee amount (e.g., 2000) — large value means the fix wasn't applied
3. Existing open trades from before this deploy will still have wrong TSL thresholds stored — they need re-entry or the Task #279 backfill to correct them

### [MILESTONE] Expiry multiplier exit-day gate — verified 2026-07-10

**Task:** #277 — Expiry multiplier exit-day gate

**What changed:** For weekly offset-0 strategies, the SEBI ELM Expiry X margin multiplier is now only applied when the strategy's configured `weeklyEndDay` matches the index's actual expiry day (from `index_margin_settings`). Previously, any plan whose target contract expired today received the multiplier regardless of whether the strategy exits before that expiry. A Monday-exit NIFTY plan was incorrectly getting the Tuesday-expiry multiplier. Monthly, custom, and next-week (offset ≥ 1) strategies are unaffected.

**Key files:**
- `artifacts/api-server/src/cm-kotak-neo-v3.ts:581-602` — added `weeklyEndDay` to `timeLogic` cast; computed `exitDayMatchesExpiry` flag; gated `isExpiry` on the flag; added log line when gate blocks the multiplier

**How it works:** `exitDayMatchesExpiry` is `true` for all strategy types except weekly offset-0 with a known `weeklyEndDay`. For that case it is `weeklyEndDay === expiryDay`. The final `isExpiry = exitDayMatchesExpiry && cmIsExpiryDay(targetExpiryDate)` — so a Monday-exit strategy on NIFTY (expiryDay=Thursday) yields `false && <whatever>` = `false`, leaving `effectiveSpanRate` at the base rate. When `weeklyEndDay` is not set in `timeLogic` (legacy plans), the condition falls through to `true` (safe default — existing behaviour preserved).

**Diagnostic — if this breaks, check:**
1. On expiry day, server logs must show `[MARGIN-CALC] Plan "X" — weeklyEndDay (Monday) ≠ expiryDay (Thursday), skipping expiry multiplier` for any plan whose exit day differs from the index expiry day
2. Plans whose `weeklyEndDay` matches `expiryDay` must still log `EXPIRY DAY: spanRate ×1.25` as before
3. If `weeklyEndDay` is missing from `timeLogic` JSON for a plan, the gate defaults to `true` (multiplier applied) — check `SELECT trade_params->>'timeLogic' FROM strategy_plans WHERE id='...'` to confirm the field is present

### [MILESTONE] Kotak Neo v3 compatibility hardening — verified 2026-09-18

**Task:** #280 — Kotak Neo v3 Compatibility Hardening

**What changed:** Added a persisted per-configuration Kotak API profile (`v3_current` by default, `v2_legacy` for compatibility), an explicit Broker API version selector, and a shared adapter that routes Kotak operations through the existing relay-backed Execution Layer. Version changes now invalidate all session state and require fresh authentication; v3 adds strict order validation and fixed ALL/ALL/ALL limits semantics.

**Key files:**
- `lib/db/src/schema/schema.ts` — added the persisted `broker_configs.api_version` profile with a safe v3 default
- `artifacts/api-server/src/kotak-api-adapter.ts` — added profile normalization, version routing, v3 order guards, and v3 limits behavior
- `artifacts/api-server/src/routes/broker-routes.ts` — validates profiles, atomically clears sessions on changes, and records profile diagnostics
- `artifacts/mentors-world/src/pages/broker-api.tsx` — added the Kotak API Version card, status, warning, and explicit save/disconnect action

**How it works:** All discovered API-server callers import the version façade instead of the raw EL singleton. Both profiles retain the proven TOTP→MPIN transport because Kotak's migration guide states that authentication flow is unchanged; v3 adds compatibility validation before entering the existing locked order block. The façade delegates network work to the unchanged EL, so Bangalore relay headers, targets, and request dispatch remain intact. Saving a different profile clears connected state, tokens, session IDs, URLs, data-center metadata, and intermediate login tokens before HSM/HSI refresh.

**Diagnostic — if this breaks, check:**
1. Confirm `broker_configs.api_version` exists, is non-null, and defaults to `v3_current`
2. On a version switch, confirm `is_connected=false` and all access/session/base URL/data-center/view token fields are null before login
3. Confirm Kotak callers import `kotak-api-adapter.ts`; only that adapter should import `el-kotak-neo-v3.ts`
4. Confirm the locked relay, authenticate, and order-management blocks in `el-kotak-neo-v3.ts` have no edits

### [MILESTONE] Layout regression guards — verified 2026-09-18

**Task:** #283 — Add scroll and responsive layout regression guards

**What changed:** Added a dependency-free automated layout suite that protects shared footer coverage, vertical page scrolling, the Broker API scroll container, global overflow safety, viewport metadata, and representative responsive layout contracts.

**Key files:**
- `artifacts/mentors-world/tests/layout-regressions.test.mjs` — added five Node test groups covering authenticated pages and shared layout invariants
- `artifacts/mentors-world/package.json` — added the `test:layout` command

**How it works:** The suite uses Node's built-in test runner to inspect the current React page sources and shared styles. It fails when an authenticated page loses its footer or viewport-height root, when a global scroll lock is introduced, when Broker API loses its explicit vertical scroll region, or when key mobile/tablet responsive classes disappear.

**Diagnostic — if this breaks, check:**
1. Run `pnpm --filter @workspace/mentors-world run test:layout` and identify the named contract that failed
2. For footer or root failures, check the page's top-level wrapper and `<PageFooter />` placement
3. For responsive failures, preserve wrapping, breakpoint, grid, and horizontal table overflow behavior instead of weakening the assertion

### [MILESTONE] Authenticated page footer scrolling — verified 2026-09-18

**Task:** #286 — Restore authenticated page scrolling to the shared footer

**What changed:** Applied one consistent vertical scroll contract to every authenticated page and removed Broker API's fixed viewport-height root. The shared footer remains in normal page flow and can be reached by scrolling through each route's content.

**Key files:**
- `artifacts/mentors-world/src/pages/user-home.tsx` — added the shared vertical scroll and overscroll classes to the authenticated home root
- `artifacts/mentors-world/src/pages/dashboard.tsx` — added the shared vertical scroll contract to the dashboard root
- `artifacts/mentors-world/src/pages/strategies.tsx` — added the shared vertical scroll contract to the strategies root
- `artifacts/mentors-world/src/pages/webhooks.tsx` — added the shared vertical scroll contract to the webhooks root
- `artifacts/mentors-world/src/pages/broker-api.tsx` — replaced fixed `h-screen` sizing with `min-h-screen` while retaining vertical scrolling
- `artifacts/mentors-world/src/pages/user-management.tsx` — added the shared vertical scroll contract to the user-management root
- `artifacts/mentors-world/src/pages/settings.tsx` — added the shared vertical scroll contract to the settings root
- `artifacts/mentors-world/tests/layout-regressions.test.mjs` — requires every authenticated root to use vertical scrolling without a standalone fixed `h-screen` lock

**How it works:** Each authenticated page keeps a minimum viewport height but explicitly allows vertical scrolling with contained overscroll. Content-heavy pages grow naturally, while a constrained preview can scroll the page root directly; intentional table, log, sheet, and dialog scroll areas remain unchanged.

**Diagnostic — if this breaks, check:**
1. Run `pnpm --filter @workspace/mentors-world run test:layout` and confirm every authenticated root has `overflow-y-auto overscroll-y-contain`
2. Check that a page root still uses `min-h-screen` or `min-h-dvh` and does not reintroduce standalone `h-screen`
3. Confirm `<PageFooter />` remains inside the page root after all page content

### [MILESTONE] UI scrolling and responsiveness crosscheck — verified 2026-09-18

**Task:** #288 — Protect UI scrolling and responsiveness during future upgrades

**What changed:** Made protected-route layout coverage derive from the application router, added authenticated browser smoke coverage for footer reachability and horizontal overflow at mobile, tablet, and desktop sizes, registered a named `ui-layout` validation, and documented the required agent crosscheck for future UI upgrades.

**Key files:**
- `artifacts/mentors-world/src/App.tsx` — centralized the seven protected routes into one router-driven inventory while preserving their existing access rules
- `artifacts/mentors-world/tests/route-inventory.mjs` — derives protected page files from the router inventory for shared test coverage
- `artifacts/mentors-world/tests/layout-regressions.test.mjs` — verifies every protected route has footer, shell, and responsive coverage
- `artifacts/mentors-world/tests/layout-browser-smoke.test.mjs` — checks authenticated route footer reachability, page overflow, and inner-scroll CSS across three viewport sizes using system Chromium
- `artifacts/mentors-world/package.json` — added `test:layout:browser` and combined `test:ui-layout` commands
- `replit.md` — added the frontend UI layout crosscheck and authenticated storage-state instructions

**How it works:** The source-level suite parses protected routes from `App.tsx`, so a new protected route must be added to the responsive contract map or validation fails. The browser suite consumes a Playwright-compatible super-admin storage-state file when supplied, launches system Chromium through the DevTools protocol, visits every protected route at three viewport sizes, scrolls the shared shell to the footer, and fails on login redirects, clipped footers, or page-level horizontal overflow. Without that state file it skips explicitly rather than treating public-page rendering as authenticated evidence.

**Diagnostic — if this breaks, check:**
1. Run `pnpm --filter @workspace/mentors-world run test:ui-layout` and identify whether the router inventory, shell, footer, or responsive contract failed
2. For authenticated browser coverage, provide `LAYOUT_TEST_STORAGE_STATE` for a non-production super-admin session and set `LAYOUT_TEST_BASE_URL` to the running frontend
3. Check `artifacts/mentors-world/src/App.tsx` protected route definitions and `tests/route-inventory.mjs` parsing if a new route is not discovered

### [MILESTONE] Production home-page scrolling — verified 2026-09-19

**Task:** #294 — Restore production home scrolling

**What changed:** The public home page now owns a viewport-height vertical scroll container instead of depending on document/body scrolling in production. Added static and real-browser regression checks for scrolling through the footer, section-anchor navigation, sticky header behavior, and horizontal overflow at mobile, tablet, and desktop widths.

**Key files:**
- `artifacts/mentors-world/src/pages/home.tsx` — added the route-local viewport scroll shell and suppressed horizontal overflow
- `artifacts/mentors-world/tests/layout-regressions.test.mjs` — protects the public home scroll, anchor, sticky-header, and footer source contracts
- `artifacts/mentors-world/tests/layout-browser-smoke.test.mjs` — verifies the rendered home page scrolls to its footer across supported viewport sizes

**How it works:** The home root is fixed to the current viewport with `h-screen h-dvh`, then owns vertical scrolling through `overflow-y-auto`; `overflow-x-hidden` prevents a mobile horizontal scrollbar from reducing the usable height. The sticky header and `#how-it-works` target remain inside the same scroll container, so native anchor navigation and sticky positioning continue to work.

**Diagnostic — if this breaks, check:**
1. Run `pnpm --filter @workspace/mentors-world run test:layout` and confirm the public home scroll-shell contract passes
2. Run `LAYOUT_TEST_BASE_URL="<running frontend URL>" pnpm --filter @workspace/mentors-world run test:layout:browser` and confirm the public home test passes at all three viewport sizes
3. Inspect `[data-testid="home-scroll-container"]`; its client height should match the viewport, `overflow-y` should be `auto`, and it should have no horizontal scrollbar

### [MILESTONE] Production logout redirect — verified 2026-09-19

**Task:** #297 — Fix production logout redirect

**What changed:** Logout now sends a validated artifact return path, produces an exact canonical post-logout URL with a trailing slash, supplies the OIDC ID-token hint when available, destroys the local Passport session, and clears both application auth cookies before leaving the app.

**Key files:**
- `artifacts/api-server/src/replit_integrations/auth/logout.ts` — added safe origin/return-path handling, OIDC end-session parameters, and resilient local session cleanup
- `artifacts/api-server/src/replit_integrations/auth/replitAuth.ts` — retains the ID token and uses the hardened logout flow
- `artifacts/mentors-world/src/hooks/use-auth.tsx` — sends the artifact base path as the intended post-logout destination
- `artifacts/api-server/tests/auth-logout.test.ts` — covers custom-domain and preview redirects, open-redirect rejection, ID-token parameters, and cleanup failures
- `artifacts/api-server/package.json` — added the focused auth regression command

**How it works:** The browser navigates to `/api/logout` with a same-origin relative `returnTo`. The server accepts only local paths, resolves them against the trusted proxied origin, includes the stored ID token in the provider logout request when available, and completes local session/cookie cleanup even if Passport or the session store reports an error.

**Diagnostic — if this breaks, check:**
1. Run `pnpm --filter @workspace/api-server run test:auth` and confirm all logout redirect and cleanup cases pass
2. Inspect the `/api/logout` 302 `Location` header; `post_logout_redirect_uri` must decode to the environment's public home URL with a trailing slash
3. Confirm both `connect.sid` and `team_session` are expired by the logout response
4. For a fresh Replit-authenticated session, confirm the OIDC end-session URL includes `id_token_hint` and returns to the public home page

### [MILESTONE] Session-aware logout routing — verified 2026-09-19

**Task:** #300 — Route logout by session type

**What changed:** Customer and team sessions now report whether local logout handled an active `team_session`. The browser returns directly to the public home page for that branch and only starts Replit OIDC logout when no local team session was active.

**Key files:**
- `artifacts/api-server/src/replit_integrations/auth/routes.ts` — reports the session type handled by the existing local logout endpoint
- `artifacts/mentors-world/src/hooks/use-auth.tsx` — routes local sessions directly home and preserves the OIDC path for Replit sessions
- `artifacts/api-server/tests/auth-logout.test.ts` — covers the session-aware response and both client redirect branches

**How it works:** The client calls local logout while the `team_session` cookie is still present. The server validates and clears that session, returns `teamSession:true`, and the client navigates directly to the artifact base path. A Replit-authenticated browser receives `teamSession:false` and continues through the hardened `/api/logout` OIDC flow.

**Diagnostic — if this breaks, check:**
1. Run `pnpm --filter @workspace/api-server run test:auth` and confirm all eight auth tests pass
2. Inspect the local logout response; an active customer/team session must return `teamSession:true`
3. Confirm the browser only requests `/api/logout` when `teamSession` is false
4. Confirm the production build includes the updated frontend bundle before testing a customer sign-out

### [MILESTONE] Versioned HSI/HSM health cards — verified 2026-09-19

**Task:** #305 — Show HSI HSM Health By Version

**What changed:** Broker API health now exposes Legacy v2 and Current v3 HSI/HSM status independently, including lifecycle state, authentication, connection details, timestamps, reconnect data, and version-specific history/reconnect actions.

**Key files:**
- `artifacts/api-server/src/hsi-kotak-neo-v3.ts` — aggregates HSI gateway instances by API version while preserving the existing primary status endpoint.
- `artifacts/api-server/src/hsm-kotak-neo-v3.ts` — labels the active HSM gateway by API version and reports configured-but-not-running versions honestly.
- `artifacts/api-server/src/routes/admin-routes.ts` — adds versioned status/history endpoints and version-targeted reconnect requests.
- `artifacts/mentors-world/src/pages/broker-api.tsx` — renders separate Legacy v2 and Current v3 HSI/HSM panels.
- `artifacts/api-server/tests/kotak-compatibility.test.ts` — verifies both profiles and avoids cross-reporting.
- `artifacts/mentors-world/tests/layout-regressions.test.mjs` — protects the versioned health-card UI contract.

**How it works:** The API derives version labels from each connected Kotak broker configuration and in-memory gateway state. The frontend fetches stable two-entry status/history collections, shows `Not configured` versus `Not running`, and posts the selected API version when reconnecting.

**Diagnostic — if this breaks, check:**
1. `GET /api/admin/hsi/status-by-version` and `GET /api/admin/hsm/status-by-version` must return `v2_legacy` and `v3_current` entries.
2. Confirm the entry’s `lifecycle`, `authOk`, and `connected` values match the gateway logs for that version.
3. Run `pnpm --filter @workspace/api-server run test:kotak` and `pnpm --filter @workspace/mentors-world run test:layout`.
4. Verify reconnect requests include `{ apiVersion: "v2_legacy" }` or `{ apiVersion: "v3_current" }` for the selected panel.
