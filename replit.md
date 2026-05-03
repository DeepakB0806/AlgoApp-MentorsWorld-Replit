# AlgoTrading Platform

## Overview
This project is an algorithmic trading platform providing professional-grade tools for automated trading strategy management. It integrates with broker APIs (e.g., Kotak Neo) and allows users to configure webhooks for real-time alerts. The platform features a live dashboard for monitoring trading activities and aims to evolve into a comprehensive algo trading marketplace with advanced features like a visual strategy builder, strategy marketplace, backtesting engine, and multi-broker support. The core principle emphasizes scalability for 1000+ concurrent users/brokers/plans, requiring atomic writes, bounded concurrency, caching with invalidation, server-side debouncing, and indexed database lookups.

## User Preferences
I prefer iterative development, where features are built and reviewed in small, manageable steps. I also prefer detailed explanations of the code and architectural decisions. Please ask before making major changes or refactoring large portions of the codebase. I value clear, concise communication and prefer using functional programming paradigms where appropriate.

## System Architecture

### UI/UX Decisions
The platform utilizes a dark trading theme with a slate/emerald color scheme. It is built with React, Vite, TypeScript, TailwindCSS, and shadcn/ui components, ensuring a modern and responsive user experience. All authenticated pages are lazy-loaded for performance optimization. A global `ErrorBoundary` is implemented for robust error handling.

### Technical Implementations
The frontend uses React with Vite, TypeScript, TailwindCSS, and shadcn/ui. The backend is an Express.js application written in TypeScript, using PostgreSQL for persistent data storage and Zod for API schema validation. Authentication supports Super Admin/Team Members with TOTP and Customer email/password. Security features include bcrypt hashing, TOTP, and HTTP-only cookie session management. Timestamp fields in the database use `bigint` to prevent overflow. Key features include a real-time Trading Dashboard, Strategy Management with risk parameters and versioning, Webhook configuration with detailed logging, Broker Integration with two-step authentication, and various Order Placement capabilities. The platform includes a Signal Processing Pipeline for resolving webhook signals, an in-memory TTL-based cache for performance, and an automated Scrip Master Sync for instrument data. It also features a Process Flow Log Viewer, Error Log Viewer, Scrip Master Data Viewer, and SSE Live Dashboard Feed for real-time updates. Capital-aware auto-deployment with margin calculation and a full-stack Trailing Stop Loss mechanism are implemented, alongside an MTM Monitor for plan-level stop-loss/profit-target breaches.

### System Design Choices
The application adopts a database-centric design with a `universal_fields` table acting as the single source of truth for universal layer fields, and `broker_field_mappings` for broker-specific field codes.
- **Translation Layer (TL)**: A database-driven engine for bidirectional translation between universal and broker-specific field names.
- **Execution Layer (EL)**: An independent, database-driven engine managing all broker API communication, authentication, order management, and data retrieval, leveraging the TL for all field translations.
- **Trade Engine (TE)**: Fully database-driven, passing only dynamic universal field values and relying on `broker_field_mappings` for static defaults and transaction type mappings.
- **Paper Trading Engine**: A simulated execution engine for strategy testing.

## External Dependencies

- **Kotak Neo Trade API**: Broker services for authentication, order management, and trading data.
- **PostgreSQL**: Primary database for persistent storage.
- **Mailjet**: Transactional email service for email verification.
- **Speakeasy & QRCode**: Libraries for TOTP generation and management.
- **Bcryptjs**: For secure password hashing.
- **Zod**: For runtime schema validation across API routes.

## Testing Credentials

- **Super Admin**: `webadmin@mentorsworld.org` / `H2so4#Hcl`
- Role: `super_admin` — full access to all routes and UI features.
- Use these credentials in all automated test plans (email/password login flow on `/login`).