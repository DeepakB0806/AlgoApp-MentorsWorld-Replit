# AlgoTrading Platform

## Overview
This project is an algorithmic trading platform designed for automated trading strategy management. It integrates with broker APIs, primarily Kotak Neo, and allows users to configure webhooks for real-time alerts from platforms like TradingView. The platform provides a live dashboard to monitor trading activities, including positions, orders, and holdings. Its core purpose is to offer professional-grade tools for automated trading, enhancing efficiency and decision-making in financial markets. The long-term vision is to evolve into a comprehensive algo trading marketplace, similar to Tradetron, offering advanced features like a visual strategy builder, strategy marketplace, backtesting engine, and multi-broker support.

## User Preferences
I prefer iterative development, where features are built and reviewed in small, manageable steps. I also prefer detailed explanations of the code and architectural decisions. Please ask before making major changes or refactoring large portions of the codebase. I value clear, concise communication and prefer using functional programming paradigms where appropriate.

## System Architecture

### UI/UX Decisions
The platform features a dark trading theme with a slate/emerald color scheme to reduce eye strain. Emerald indicates positive P&L and primary actions, while red signifies negative P&L and sell actions. The UI is built with React, Vite, TypeScript, TailwindCSS, and shadcn/ui components, ensuring a modern and responsive user experience. It includes distinct public and authenticated home pages. All authenticated pages are lazy-loaded using `React.lazy()` and `Suspense` to optimize performance.

### Technical Implementations
The frontend uses React with Vite, TypeScript, TailwindCSS, and shadcn/ui. A global `ErrorBoundary` in `App.tsx` catches runtime errors and displays a user-friendly error screen with reload button instead of blank white pages. The backend is an Express.js application written in TypeScript. Data is primarily stored in PostgreSQL, with in-memory storage for development and temporary data. Zod is used for schema validation on all API routes. Authentication supports Super Admin/Team Members with TOTP and Customer email/password, including email verification. The application is structured into `client/`, `server/`, and `shared/` directories. Security features include bcrypt hashing, TOTP, and HTTP-only cookie session management. Timestamp fields in the database use `bigint` to prevent overflow.

### Feature Specifications
- **Trading Dashboard**: Real-time overview of portfolio, P&L, positions, orders, and holdings.
- **Strategy Management**: CRUD operations for automated trading strategies, including deployment, risk management parameters (lot multiplier, Stoploss MTM, Profit Target MTM), and configuration versioning.
- **Webhooks**: Configuration for receiving alerts from external platforms (e.g., TradingView), including secret key generation, detailed logging, and linking to strategies.
- **Broker Integration**: Manages API credentials for brokers like Kotak Neo, supporting two-step authentication and providing access to trading functionalities and reporting.
- **Order Placement**: Interface for placing various order types with `exchange` and `ticker` fields for broker API order parameters.
- **Time Logic Configuration**: Enhanced time logic with `expiryType` (weekly/monthly/custom) and associated day calculations.
- **Signal Processing Pipeline**: Actively uses `actionMapper` to resolve signals from webhooks, supporting exchange/ticker inheritance and correct `blockType` propagation, with strategy-type-aware clean entry logic. Exit signals (SELL_UT, SELL_DT) now place actual counter-orders on the broker to square off positions before closing the DB record. Price validation guards prevent orders with missing/zero spot prices for OTM/ITM strike specs. Composite signals (SELL_UT+BUY_DT, SELL_DT+BUY_UT) are now fully supported — `resolveAllSignalsFromActionMapper` returns an array of actions (EXIT first, then ENTRY), and the webhook route loops through all actions sequentially.
- **Performance Optimization**: Features a unified trade engine, an in-memory TTL-based cache layer with invalidation, hot/cold path separation for webhook handling, and database indexes for hot path queries.
- **Scrip Master Sync**: Automatically fetches and updates instrument data (lot sizes, strike intervals) from broker APIs into the `instrument_configs` table, ensuring up-to-date trading parameters. Lot size parsing uses mode (most frequent value) instead of minimum, and prioritizes `lotsize`/`plotsize` columns over `brdlotqty`.
- **Error Log Viewer**: Aggregates errors from webhook_status_logs, broker_test_logs, and broker_session_logs into a unified Error Log card on the Broker API page. Includes Kotak error code descriptions. TOTP values are redacted.
- **Scrip Master Data Viewer**: Sub-card under Broker API Field Reference showing raw CSV data, per-ticker lot size summary with mismatch highlighting against DB values.

### System Design Choices
The application adheres to a database-centric design where every field is stored in the database. The `universal_fields` table (130 fields) serves as the single source of truth for all universal layer fields. Broker API specific fields are mapped in the `broker_field_mappings` table. This design supports a "Universal Layer" for consistent data representation.

- **Translation Layer (TL)**: An independent, database-driven engine that loads field mappings from `broker_field_mappings` and `universal_fields` to perform bidirectional translation between universal field names and broker-specific field codes for API requests and responses. It provides functions for translating payloads and single field lookups, with a reload mechanism for runtime updates.
- **Execution Layer (EL)**: An independent, database-driven engine handling all broker API communication. It loads API endpoints, exchange mappings, and active header templates (filtered by `is_active=true`) from database tables (`broker_api_endpoints`, `broker_exchange_maps`, `broker_headers`) on startup. Auth types: `session` (5 headers: accept, Sid, Auth, neo-fin-key, Content-Type + inactive Authorization), `consumer_key` (3 headers for TOTP login), `consumer_key_with_view` (5 headers for MPIN login), `consumer_key_only` (Authorization only — used for Quotes and ScripMaster per Kotak spec). Content-Type auto-injection is skipped for GET requests. The EL provides a comprehensive set of functions for authentication, order management, data retrieval (positions, orders, holdings), and connectivity testing. It calls the TL for all field translations, ensuring zero hardcoded URLs, field codes, or headers. Order placement logs request body and full broker response for debugging. Error parsing handles Kotak's `emsg` field alongside `message`/`errMsg`.
- **Trade Engine (TE) DB-Driven Payloads**: The TE (`te-kotak-neo-v3.ts`) builds order payloads using `buildKotakOrderPayload()` which reads universal field names from the TL via `getUniversalName(brokerFieldCode)`. This ensures order payload keys always match the DB-defined universal field names (e.g., `exchange` not `exchangeSegment`, `productType` not `productCode`). All 3 order placement paths (entry buy, entry sell, exit close) use this helper. If the TL is not ready, it falls back to using broker field codes directly.
- **Paper Trading Engine**: A simulated execution engine for strategy testing, which operates without the `resolvedAction` or clean entry guards present in the live trading engine.

## External Dependencies

- **Kotak Neo Trade API**: Broker services for authentication, order management, and trading data.
- **PostgreSQL**: Primary database for persistent storage of all application and trading data.
- **Mailjet**: Transactional email service used for email verification.
- **Speakeasy & QRCode**: Libraries for generating and managing Time-based One-Time Passwords (TOTP) for secure authentication.
- **Bcryptjs**: Used for secure hashing of passwords.
- **Zod**: Utilized for runtime schema validation across all API routes, ensuring data integrity.