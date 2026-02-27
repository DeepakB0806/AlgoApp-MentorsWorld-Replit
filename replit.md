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
- **Signal Processing Pipeline**: Actively uses `actionMapper` to resolve signals from webhooks, supporting exchange/ticker inheritance and correct `blockType` propagation.
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
The TL reads from the production database at runtime. Zero hardcoded field names. The EL (`server/kotak-neo-api.ts`) calls the TL for all field translations. Dev and production have separate databases; use "Sync Broker Fields" and "Sync Universal Fields" buttons to push data from dev to production.

### Route Ordering Notes
- `/api/webhooks/default-fields` must be registered BEFORE `/api/webhooks/:id` to prevent Express from treating "default-fields" as an ID parameter. This is handled by the webhook-routes module.

## External Dependencies

- **Kotak Neo Trade API**: Broker services, authentication, order management, trading data.
- **PostgreSQL**: Primary database for persistent storage.
- **Mailjet**: Transactional email service for email verification.
- **Speakeasy & QRCode**: TOTP generation and management for secure authentication.
- **Bcryptjs**: Secure password hashing.
- **Zod**: Runtime schema validation.
