# AlgoTrading Platform

## Overview
This project is an algorithmic trading platform designed for automated trading strategy management. It integrates with broker APIs, primarily Kotak Neo, and allows users to configure webhooks for real-time alerts from platforms like TradingView. The platform provides a live dashboard to monitor trading activities, including positions, orders, and holdings. Its core purpose is to offer professional-grade tools for automated trading, enhancing efficiency and decision-making in financial markets. The long-term vision is to evolve into a comprehensive algo trading marketplace, similar to Tradetron, offering advanced features like a visual strategy builder, strategy marketplace, backtesting engine, and multi-broker support.

## User Preferences
I prefer iterative development, where features are built and reviewed in small, manageable steps. I also prefer detailed explanations of the code and architectural decisions. Please ask before making major changes or refactoring large portions of the codebase. I value clear, concise communication and prefer using functional programming paradigms where appropriate.

## System Architecture

### UI/UX Decisions
The platform features a dark trading theme with a slate/emerald color scheme to reduce eye strain. Emerald indicates positive P&L and primary actions, while red signifies negative P&L and sell actions. The UI is built with React, Vite, TypeScript, TailwindCSS, and shadcn/ui components, ensuring a modern and responsive user experience. It includes distinct public and authenticated home pages.

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
The application adheres to a principle where every field exposed by a broker's API must be mapped to a universal layer. This includes an 8-step Standard Operating Procedure (SOP) for broker onboarding, ensuring comprehensive field mapping and gap mitigation before building translation layers. Dashboard tables are oriented to display all broker-provided fields for positions, orders, and holdings.

## External Dependencies

- **Kotak Neo Trade API**: Broker services, authentication, order management, trading data.
- **PostgreSQL**: Primary database for persistent storage.
- **Mailjet**: Transactional email service for email verification.
- **Speakeasy & QRCode**: TOTP generation and management for secure authentication.
- **Bcryptjs**: Secure password hashing.
- **Zod**: Runtime schema validation.