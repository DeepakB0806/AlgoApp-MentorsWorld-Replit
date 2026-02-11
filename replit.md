# AlgoTrading Platform

## Overview
This project is an algorithmic trading platform that enables automated trading strategy management. It integrates with broker APIs, primarily Kotak Neo, and allows users to configure webhooks for real-time alerts from platforms like TradingView. The platform provides a live dashboard to monitor trading activities, including positions, orders, and holdings. The core purpose is to empower users with tools for professional-grade automated trading, enhancing efficiency and decision-making in financial markets.

## User Preferences
I prefer iterative development, where features are built and reviewed in small, manageable steps. I also prefer detailed explanations of the code and architectural decisions. Please ask before making major changes or refactoring large portions of the codebase. I value clear, concise communication and prefer using functional programming paradigms where appropriate.

### Testing Credentials
Always use the Super Admin credentials for testing authenticated features unless specified otherwise:
- **Email**: webadmin@mentorsworld.org
- **Password**: H2so4#Hcl
- **Production Domain**: algoapp.mentorsworld.org

## System Architecture

### UI/UX Decisions
The platform features a dark trading theme with a primary focus on reducing eye strain, utilizing a slate/emerald color scheme. Emerald is used for positive P&L and primary actions, while red signifies negative P&L and sell actions. The background uses a dark slate. The UI is built with React, Vite, TypeScript, TailwindCSS, and shadcn/ui components, providing a modern and responsive user experience. The design includes public and authenticated home pages, with the public page serving as a marketing front and the authenticated page offering a personalized dashboard experience.

### Technical Implementations
The frontend is developed using React with Vite, TypeScript, and TailwindCSS, augmented by shadcn/ui for UI components. The backend is an Express.js application written in TypeScript. Data is primarily stored in a PostgreSQL database, with in-memory storage (MemStorage) used for development and specific temporary data like strategies. The application uses Zod for schema validation on all API routes, ensuring data integrity. Authentication supports dual modes (Super Admin/Team Members with TOTP and Customer email/password) and includes email verification for new sign-ups.

### Feature Specifications
- **Trading Dashboard**: Provides a real-time overview of portfolio value, P&L, positions, orders, and holdings, with data fetched live from the integrated broker API or mock data otherwise.
- **Strategy Management**: Allows users to create, edit, toggle, and delete automated trading strategies.
- **Webhooks**: Enables configuration of webhooks for receiving alerts from external platforms like TradingView, including secret key generation and detailed logging of webhook executions and statistics (success rate, response time). Webhook data, including raw payloads and parsed TradingView fields, is stored and linked to strategies for processing.
- **Broker Integration**: Manages API credentials for brokers like Kotak Neo, supporting a two-step authentication process (TOTP login and MPIN validation) and providing access to trading functionalities (order placement, modification, cancellation) and reporting (order book, positions, holdings). Broker credentials and session tokens are securely stored in the PostgreSQL database.
- **Order Placement**: A dedicated interface for placing buy/sell orders with support for various order types.
- **Webhook Linking**: A feature to link development webhooks to production data streams for testing with live data without affecting production.

### System Design Choices
The application is structured into `client/`, `server/`, and `shared/` directories for clear separation of concerns. `shared/` contains common Zod schemas and TypeScript types. Authentication includes robust security features like bcrypt hashing for passwords, TOTP for team members, and session management using HTTP-only cookies. Environment detection for URLs is automated, using request headers for dynamic URL generation, with a database-stored domain name as a fallback. Critical timestamp fields in the database use `bigint` to prevent overflow errors with millisecond timestamps.

## Future Development Plans

### Tradetron Alike Development Plan
Inspired by Tradetron (tradetron.tech), a popular Indian algo trading marketplace platform. The following enhancements are planned for future implementation to bring the platform closer to a Tradetron-style experience:

1. **Dashboard Redesign** - Tradetron-style overview with consolidated P&L summary, open positions, order book, and notification log in organized cards/widgets with customizable layout
2. **Strategy Management UI Overhaul** - Cleaner strategy cards with status indicators, one-click deploy/toggle, performance metrics, and deployed strategies real-time monitoring panel
3. **Visual Strategy Builder** - Drag-and-drop no-code interface with 150+ keywords (technical indicators, option Greeks, price actions), multi-legged strategy support, and advanced execution logic
4. **Strategy Marketplace** - Browse, subscribe to, and publish trading strategies with community ratings, performance transparency (returns, drawdowns, Sharpe ratios), and monetization tools
5. **Backtesting Engine** - Comprehensive backtesting with historical data, visual results, and validation of entry/exit rules before going live
6. **Paper Trading Mode** - Free deployment for testing strategies without risking real capital
7. **Multi-Broker Support** - Expand beyond Kotak Neo to support additional Indian brokers (Zerodha, Angel One, Fyers, etc.)
8. **Navigation Restructure** - Sidebar-driven layout with clear sections mirroring Tradetron's professional navigation
9. **Mobile-Responsive Redesign** - Full functionality on phones/tablets with sleek, fast interface
10. **Advanced Execution Features** - Position sequencing, order tranching, auto-reverse for unfilled legs, and built-in execution algorithms

**Priority**: Items 1-2 (UI refresh) are lower effort and can be tackled first. Items 3-6 (core features) are major undertakings requiring significant backend work. Items 7-10 are longer-term enhancements.

## External Dependencies

- **Kotak Neo Trade API**: Integrated for broker services, including authentication, order management, and fetching trading data (positions, orders, holdings, quotes).
- **PostgreSQL**: Primary database for persistent storage of broker credentials, webhooks, webhook logs, webhook registry, webhook data, and user information.
- **Mailjet**: Used for sending transactional emails, specifically for customer email verification.
- **Speakeasy & QRCode**: Utilized for generating and managing TOTP (Time-based One-Time Password) for secure authentication.
- **Bcryptjs**: Employed for secure password hashing.
- **Zod**: Used for runtime schema validation across the application's API endpoints.