# AlgoTrading Platform

## Overview
This project is an algorithmic trading platform designed for automated trading strategy management. It integrates with broker APIs, primarily Kotak Neo, and allows users to configure webhooks for real-time alerts from platforms like TradingView. The platform provides a live dashboard to monitor trading activities, including positions, orders, and holdings. Its core purpose is to offer professional-grade tools for automated trading, enhancing efficiency and decision-making in financial markets. The long-term vision is to evolve into a comprehensive algo trading marketplace, similar to Tradetron, offering advanced features like a visual strategy builder, strategy marketplace, backtesting engine, and multi-broker support.

## User Preferences
I prefer iterative development, where features are built and reviewed in small, manageable steps. I also prefer detailed explanations of the code and architectural decisions. Please ask before making major changes or refactoring large portions of the codebase. I value clear, concise communication and prefer using functional programming paradigms where appropriate.

## System Architecture

### Code Organization
The backend routes are split into focused modules in `server/routes/`:
- `webhook-routes.ts` (~973 lines) — Webhook CRUD, receiver endpoint, webhook data, linking, registry, test
- `broker-routes.ts` (~844 lines) — Broker configs, auth, session helpers, positions/orders/holdings/portfolio, deployment, trades, daily-pnl, test logs, session logs
- `strategy-routes.ts` (~238 lines) — Strategy CRUD, strategy configs, strategy plans
- `field-mapping-routes.ts` (~90 lines) — Broker field mapping routes (database-driven matching, no hardcoded constants)
- `universal-field-routes.ts` (~70 lines) — Universal field CRUD (master reference table for the Universal Layer)
- `admin-routes.ts` (~148 lines) — Settings, email, webhook-logs, admin sync
- `helpers.ts` (~41 lines) — Shared auth helpers (getUserFromRequest, requireSuperAdmin, requireTeamOrSuperAdmin, parseNumeric)
- `routes.ts` (~21 lines) — Thin orchestrator that imports and calls each module

The frontend strategy components are split into lazy-loaded modules:
- `client/src/components/strategy-config.tsx` (~648 lines) — MotherConfigurator component
- `client/src/components/trade-planning.tsx` (~967 lines) — TradePlanning component
- `client/src/components/broker-linking.tsx` (~1,266 lines) — BrokerLinking + sub-components (TradeTableContent, LivePositionTracker, DailyPnlTable, DailyPnlLogSheet)
- `client/src/pages/strategies.tsx` (~55 lines) — Thin wrapper with Tabs, lazy-loads above components

### Lazy Loading (React.lazy)
All authenticated pages are lazy-loaded in `App.tsx` using `React.lazy()` and `Suspense`. This reduces Vite's peak compilation memory during development by only compiling pages when they're navigated to. The strategy page additionally lazy-loads its tab components.

### UI/UX Decisions
The platform features a dark trading theme with a slate/emerald color scheme to reduce eye strain. Emerald indicates positive P&L and primary actions, while red signifies negative P&L and sell actions. The UI is built with React, Vite, TypeScript, TailwindCSS, and shadcn/ui components, ensuring a modern and responsive user experience. It includes distinct public and authenticated home pages.

### Server Lifecycle
- **Graceful shutdown**: SIGTERM/SIGINT handlers close `httpServer` before exiting, ensuring port 5000 is released cleanly between restarts.
- **Port retry**: If port 5000 is still in use on startup (EADDRINUSE), the server retries up to 3 times with 1-second delays.
- **Production mode**: The workflow runs the pre-built production bundle (`NODE_ENV=production node dist/index.cjs`) to avoid tsx compilation and Vite dev server overhead. After code changes, run `npx tsx script/build.ts` to rebuild before restarting.
- **Development mode**: Use `npm run dev` for local development with hot-reload (tsx + Vite dev server).

### Technical Implementations
The frontend uses React with Vite, TypeScript, TailwindCSS, and shadcn/ui. The backend is an Express.js application written in TypeScript. Data is primarily stored in PostgreSQL, with in-memory storage for development and temporary data. Zod is used for schema validation on all API routes. Authentication supports Super Admin/Team Members with TOTP and Customer email/password, including email verification. The application is structured into `client/`, `server/`, and `shared/` directories. Security features include bcrypt hashing, TOTP, and HTTP-only cookie session management. Timestamp fields in the database use `bigint` to prevent overflow.

### Feature Specifications
- **Trading Dashboard**: Real-time overview of portfolio, P&L, positions, orders, and holdings.
- **Strategy Management**: CRUD operations for automated trading strategies.
- **Webhooks**: Configuration for receiving alerts from external platforms (e.g., TradingView), including secret key generation, detailed logging, and linking to strategies.
- **Broker Integration**: Manages API credentials for brokers like Kotak Neo, supporting two-step authentication and providing access to trading functionalities and reporting.
- **Order Placement**: Interface for placing various order types.
- **Deployment & Risk Management**: Includes lot multiplier, editable Stoploss MTM / Profit Target MTM values, and strategy deployment lifecycle management (archive, re-deploy).
- **Config Versioning**: Tracks strategy configuration versions and indicates when new versions are available for deployed strategies.
- **Exchange & Ticker Fields**: Supports `exchange` and `ticker` fields on strategy plans for broker API order parameters.
- **Time Logic Configuration**: Enhanced time logic with `expiryType` (weekly/monthly/custom) and associated day calculations.
- **Signal Processing Pipeline**: Actively uses `actionMapper` to resolve signals from webhooks, supporting exchange/ticker inheritance and correct `blockType` propagation. `resolveSignalFromActionMapper` returns `resolvedAction` (ENTRY/EXIT/HOLD) alongside `signalType` and `blockType`. Features **strategy-type-aware clean entry logic** via `awaitingCleanEntry` flag on strategy plans — guards check `resolvedAction === EXIT` (not `signalType === sell`), so option selling strategies where entry is a sell are not blocked. Flag set `true` on activation AND when `closeTrade` leaves zero open positions (covers expiry exits, reversals, square-offs). Flag cleared on any successful ENTRY trade (buy or sell). Paper trade engine has separate `resolveSignalFromActionMapper` without `resolvedAction`.
- **Performance Optimization**: Features a unified trade engine, an in-memory TTL-based cache layer with invalidation, hot/cold path separation for webhook handling, and database indexes for hot path queries.

### System Design Choices
The application adheres to a principle where every field must be in the database — no exceptions. The Universal Layer fields are stored in the `universal_fields` database table (130 fields), serving as the single source of truth. Broker API fields are stored in the `broker_field_mappings` table. The API Field Reference UI shows the 1:1 matching between these two database tables, with a searchable dropdown for selecting universal fields (no hardcoded values). The 8-step SOP-BOP ensures comprehensive field mapping and gap mitigation before building translation layers. Dashboard tables are oriented to display all broker-provided fields for positions, orders, and holdings. On server startup, `ensureUniversalFields()` checks if the `universal_fields` table is empty and auto-populates all 130 fields — this ensures dev and production databases always have identical reference data. The Re-sync (`/revalidate`) endpoint performs pure DB-to-DB matching: reads `broker_field_mappings`, validates each `universalFieldName` against `universal_fields`, updates match status, and returns a correlation report.

### Translation Layer (TL)
The Translation Layer (`server/tl-kotak-neo-v3.ts`) is an independent engine that sits on top of the database. It loads all field mappings from `broker_field_mappings` (192 fields) and `universal_fields` (130 fields) on startup and builds internal lookup maps for fast translation. The TL provides:
- `translateRequest(category, universalPayload)` — converts universal field names to broker field codes for outgoing API requests
- `translateResponse(category, brokerPayload)` — converts broker field codes to universal field names for incoming responses
- `getBrokerFieldCode(universalFieldName)` / `getUniversalFieldName(brokerFieldCode)` — single field lookups
- `buildRequestPayload(category, payload, includeDefaults)` — builds broker-format payload with optional defaults from DB
- `reload()` — refreshes mappings from database without server restart
- `getStatus()` — returns health, field counts, categories, load time
- Status endpoint: `GET /api/tl/kotak_neo_v3/status`, Reload endpoint: `POST /api/tl/kotak_neo_v3/reload`
The TL reads from the production database at runtime. Zero hardcoded field names.

### Execution Layer (EL)
The Execution Layer (`server/el-kotak-neo-v3.ts`) is an independent, database-driven engine that handles all broker API communication. It loads endpoints, headers, and exchange mappings from 3 database tables on startup:
- `broker_api_endpoints` (16 Kotak endpoints) — endpoint paths, HTTP methods, body formats, auth types
- `broker_exchange_maps` (6 exchange mappings) — universal code to broker code translation (NSE→nse_cm, NFO→nse_fo, etc.)
- `broker_headers` (11 header templates) — header resolution by auth type (static values or config field lookups)
- Seed file: `server/seed-broker-el.ts` — `ensureBrokerEndpoints()` auto-populates tables on startup
The EL provides: `authenticate()`, `placeOrder()`, `modifyOrder()`, `cancelOrder()`, `getPositions()`, `getHoldings()`, `getOrderBook()`, `getTradeBook()`, `getOrderHistory()`, `checkMargin()`, `getLimits()`, `getQuotes()`, `getScripMasterFilePaths()`, `mapExchange()`, `testConnectivity()`
- `reload()` — refreshes from database without server restart
- `getStatus()` — returns endpoint/exchange/header counts, categories, health
- Status endpoint: `GET /api/el/kotak_neo_v3/status`, Reload endpoint: `POST /api/el/kotak_neo_v3/reload`
The EL calls TL for all field translations. Zero hardcoded URLs, field codes, or headers. Architecture: Trade Engine → EL → TL → Production DB.

### Scrip Master Sync
The scrip master sync (`server/scrip-master-sync.ts`) auto-fetches instrument data from Kotak Neo's scrip master API after successful TOTP login. It downloads the NFO CSV, parses index option instruments (NIFTY, BANKNIFTY, FINNIFTY, etc.), and upserts lot sizes and strike intervals into the `instrument_configs` table. This ensures the platform always has current lot sizes when regulations change (e.g., NIFTY lot size changed from 75 to 65).
- Triggered: automatically after successful TOTP login (background task via `setImmediate`)
- Manual trigger: `POST /api/instrument-configs/sync` with `{ brokerConfigId }` 
- Query: `GET /api/instrument-configs`, `GET /api/instrument-configs/:ticker`
- Table: `instrument_configs` (ticker, exchange, lot_size, strike_interval, expiry_day, expiry_type, token, instrument_type, source)

### Data Flow
Dev and production have separate databases; use "Sync Broker Fields" and "Sync Universal Fields" buttons to push data from dev to production. The 3 EL tables (broker_api_endpoints, broker_exchange_maps, broker_headers) also need sync after publish.

### Route Ordering Notes
- `/api/webhooks/default-fields` must be registered BEFORE `/api/webhooks/:id` to prevent Express from treating "default-fields" as an ID parameter. This is handled by the webhook-routes module.

## Future Plans

### Team Members Rights — Role-Based Access with Admin Dashboard
**Status: Planned — Not Yet Implemented**

A two-layer permission system with an Admin Dashboard (DB browser + File Manager) and a refined 3-tier role structure:

**Role tiers:**
- `team_member` → Strategies (create trade plans), Dashboard, Broker API (own configs)
- `developer` → Everything team_member has + Field Mappings + EL/TL controls + Admin Dashboard with full read-write DB browser + File Manager (browse, read, edit, create files). A developer can work entirely from the production UI without needing Replit access.
- `super_admin` → Everything developer has + User Management + Settings + Mother Config create/edit + can promote team_member → developer

**Key features:**
1. **3-tier role system** — `team_member`, `developer`, `super_admin`
2. **Role promotion** — Only super_admin can promote/demote team_member ↔ developer from User Management page
3. **Admin Dashboard — Database tab** — Browse 10 system tables (broker_field_mappings, broker_api_endpoints, broker_exchange_maps, broker_headers, universal_fields, broker_configs, strategy_configs, strategy_plans, webhooks, webhook_data), paginated table viewer with search/sort, row detail/edit dialog, CSV export
4. **Admin Dashboard — Files tab** — File tree browser (server/, client/, shared/), read/edit/create/delete files, syntax-highlighted code editor, security guardrails (no .env, node_modules, .git access)
5. **Route permission refinement** — Field mappings and EL/TL controls restricted to developer+, User Management and Settings restricted to super_admin only
6. **Hub card visibility** — UserHome cards filtered by role, role badge displayed next to user info

**Implementation tasks (9 total):**
- T001: Add `developer` role to schema and auth system
- T002: Add role promotion controls to User Management page
- T003: Refine route-level permissions for 3-tier roles
- T004: Build Admin Dashboard backend — DB browser API
- T005: Build Admin Dashboard backend — File Manager API
- T006: Build Admin Dashboard frontend — DB browser tab
- T007: Build Admin Dashboard frontend — File Manager tab
- T008: Update UserHome hub cards for role visibility
- T009: Test and verify

## QC Function Reference (15 Files)
**Checkpoint**: `191f2ab` | **Date**: February 28, 2026

### File 1: `server/trade-engine.ts` (487 lines)
Core trade execution engine — signal resolution, clean entry guard, buy/sell execution, trade closing, daily P&L tracking.

**Interfaces**: `SignalContext` (blockType, resolvedAction, parentExchange, parentTicker), `TradeResult` (success, action, broker, planId, trade, orderId, pnl, message, executionTimeMs), `TradeContext` (ticker, exchange, price, resolvedBlockType, lotMultiplier, now, today, data, openTrades, signalContext, startTime)

**Functions (8)**:
1. `resolveSignalFromActionMapper(signalData, actionMapperJson)` — Matches signal against action mapper → returns `{signalType, blockType, resolvedAction}`. Falls back to signalType/actionBinary.
2. `buildBinanceSession(config)` — Extracts Binance credentials → BinanceSession or null.
3. `processTradeSignal(storage, webhookData, strategyConfigId, signalContext?)` — Main entry. Finds active plans, loads broker configs, executes in parallel via Promise.allSettled.
4. `executeTradeForPlan(storage, plan, brokerConfig, data, signalContext?)` — Single plan orchestration. Clean entry guard: awaitingCleanEntry + resolvedAction===EXIT + no open trades → skip.
5. `executeBuySignal(storage, plan, brokerConfig, ctx)` — BUY execution. Duplicate check, reversal close, order placement (Kotak/Binance/paper), clears awaitingCleanEntry.
6. `executeSellSignal(storage, plan, brokerConfig, ctx)` — SELL execution. Duplicate check, reversal close, order placement, clears awaitingCleanEntry.
7. `closeTrade(storage, trade, exitPrice, now)` — Closes trade with P&L. If zero remaining open trades → resets awaitingCleanEntry=true.
8. `deferDailyPnlUpdate(storage, planId, date, tradePnl)` — Non-blocking daily P&L update via setImmediate.

### File 2: `server/el-kotak-neo-v3.ts` (796 lines)
Execution Layer — DB-driven Kotak Neo API client. Loads endpoints, exchange maps, headers from database.

**Internal State**: endpoints, endpointsByCategory, endpointByName, exchangeMap, reverseExchangeMap, headersByAuthType

**Functions (29)**: init, buildMaps, reload, isReady, getStatus, mapExchange, reverseMapExchange, getEndpoint, buildHeaders, buildHeadersForEndpoint, resolveUrl, formatBody, executeRequest, authenticate (2-step TOTP→MPIN), placeOrder, modifyOrder, cancelOrder, getOrderBook, getTradeBook, getPositions, getHoldings, getOrderHistory, checkMargin, getLimits, getQuotes, testConnectivity, executeGetRequest, extractArray, isSessionError

### File 3: `server/tl-kotak-neo-v3.ts` (434 lines)
Translation Layer — DB-driven field mapper. Bidirectional: universal names ↔ broker field codes.

**Functions (23)**: init, buildMaps, reload, isReady, getStatus, translateRequest, translateResponse, getBrokerField, getBrokerFieldCode, getUniversalField, getUniversalFieldName, getFieldsByCategory, getFieldsByDirection, getFieldsByCategoryAndDirection, getCategories, getAllowedValues, getDefaultValue, getUniversalFieldMetadata, getRequestFields, getResponseFields, buildRequestPayload, parseResponsePayload, castValue

### File 4: `server/routes/webhook-routes.ts` (975 lines)
Webhook routes — receiving TradingView alerts, signal storage, webhook management, production linking, signal replay.

**Route Handlers (32)**: GET/POST/PATCH/DELETE webhooks CRUD, POST /api/webhook/:id (HOT PATH — receives alerts, resolves signal, triggers trade execution, responds immediately, logs async), webhook-registry sync, webhook-data CRUD/cleanup, POST process-production-signals (signal replay with dedup), link/unlink dev↔production, webhook-signals field discovery, webhook-field-values

### File 5: `shared/schema.ts` (730 lines)
Single source of truth — all database tables, types, data models. Drizzle ORM + PostgreSQL.

**Types (11)**: PredefinedIndicator, ActionMapperEntry, TradeLeg, ExecutionBlock, PlanTradeLeg, BlockConfig, StoplossConfig, ProfitTargetConfig, TrailingStoplossConfig, TimeLogicConfig, TradeParams
**Tables (18+)**: strategy_configs, strategy_plans, strategy_trades, strategy_daily_pnl, strategies, webhook_registry, webhooks, webhook_logs, webhook_status_logs, webhook_data, app_settings, broker_configs, broker_test_logs, broker_session_logs, broker_field_mappings, universal_fields, broker_api_endpoints, broker_exchange_maps, broker_headers
**Interfaces**: Position, Order, Holding, PortfolioSummary, LoginCredentials, KotakNeoAuthResponse, OrderParams

### File 6: `server/storage.ts` (1367 lines)
Storage interface + PostgreSQL implementation. All DB CRUD operations (~80 methods).

**Method Groups**: Strategy CRUD (6), Plan CRUD (5), Trade CRUD (5), Daily P&L (3), Webhook CRUD (10+), Webhook Data (8), Broker Config (5), Broker Logs (4), Field Mapping (4), Settings (2)

### File 7: `server/routes/broker-routes.ts` (688 lines)
Broker management routes — config CRUD, authentication, connectivity testing, deployment, portfolio data.

**Route Handlers (28)**: broker-configs CRUD, /authenticate, /test, positions, orders, holdings, portfolio-summary, strategy-plans deployment, strategy-trades CRUD, strategy-daily-pnl CRUD, broker-session-status, test-logs, session-logs

### File 8: `server/cache.ts` (157 lines)
In-memory TTL cache for hot path optimization.

**TTLs**: HOT_PATH 2min (webhooks, configs), BROKER_SESSION 5min, OPEN_TRADES 10sec
**TradingCache (14 methods)**: get/set/invalidate for Webhook, ConfigByWebhookId, ConfigById, BrokerConfig, ActivePlansByConfigId, OpenTradesByPlanId + invalidateAll + warmUp

### File 9: `server/seed-broker-el.ts` (80 lines)
Seeds EL database tables on first run. `ensureBrokerEndpoints()` → 15 endpoints, 6 exchange mappings, 11 header templates.

### File 10: `client/src/pages/broker-api.tsx` (2589 lines)
Broker API dashboard — field reference, broker config management, authentication flow.

**Components**: ApiFieldsReference (1:1 field mapping, 5-step sync/reload), BrokerConfigCard (credentials, TOTP auth, sessions), BrokerApi (main page)

### File 11: `client/src/components/strategy-config.tsx` (648 lines)
Strategy configuration — action mapper, webhook linking, indicator selection.

**Components**: MotherConfigurator (config create/edit with action mapper, execution blocks)

### File 12: `client/src/components/trade-planning.tsx` (1078 lines)
Trade planning — plan create/edit, deployment lifecycle, exit conditions.

**Components**: TradePlanning (legs, SL/PT/TSL, time logic, deployment lifecycle)

### File 13: `server/paper-trade-engine.ts` (262 lines)
Paper trading engine — simulated execution, no resolvedAction, no clean entry guard.

**Functions (5)**: resolveSignalFromActionMapper (returns {signalType, blockType} only), processPaperTrade, executePaperTradeForPlan, closePaperTrade, updateDailyPnl

### File 14: `server/routes/helpers.ts` (41 lines)
Shared route utilities.

**Functions (4)**: parseNumeric, getUserFromRequest, requireSuperAdmin, requireTeamOrSuperAdmin

### File 15: `replit.md`
Architecture documentation — project overview, features, design principles, tech stack, file structure, QC function reference.

## External Dependencies

- **Kotak Neo Trade API**: Broker services, authentication, order management, trading data.
- **PostgreSQL**: Primary database for persistent storage.
- **Mailjet**: Transactional email service for email verification.
- **Speakeasy & QRCode**: TOTP generation and management for secure authentication.
- **Bcryptjs**: Secure password hashing.
- **Zod**: Runtime schema validation.
