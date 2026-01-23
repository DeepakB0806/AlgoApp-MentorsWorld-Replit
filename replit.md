# AlgoTrading Platform

## Overview
A professional algorithmic trading platform adapted from a Next.js + Python application. Features automated trading strategy management, webhook configuration for TradingView alerts, broker API integration (Kotak Neo), and a live trading dashboard with positions, orders, and holdings tracking.

## Architecture

### Tech Stack
- **Frontend**: React + Vite + TypeScript + TailwindCSS + shadcn/ui
- **Backend**: Express.js with TypeScript
- **Data Storage**: In-memory storage (MemStorage) for development
- **Styling**: Dark trading theme with slate/emerald color scheme

### Project Structure
```
client/src/
├── pages/
│   ├── home.tsx         # Landing page with features
│   ├── dashboard.tsx    # Trading dashboard with positions/orders/holdings
│   ├── strategies.tsx   # Strategy management CRUD
│   ├── webhooks.tsx     # Webhook configuration for alerts
│   └── broker-api.tsx   # Broker API credentials management
├── components/ui/       # shadcn/ui components
└── lib/                 # Query client and utilities

server/
├── routes.ts            # Express API endpoints
├── storage.ts           # In-memory data storage
├── kotak-neo-api.ts     # Kotak Neo API client
└── index.ts             # Server entry point

shared/
└── schema.ts            # Zod schemas and TypeScript types
```

### Key Features
1. **Trading Dashboard**: Real-time view of portfolio value, P&L, positions, orders, and holdings
2. **Strategy Management**: Create, edit, toggle, and delete trading strategies
3. **Webhooks**: Configure webhooks for TradingView alerts with secret key generation
4. **Broker Integration**: Manage Kotak Neo and other broker API credentials
5. **Order Placement**: Form to place buy/sell orders with various order types

### API Endpoints
- `GET/POST /api/strategies` - Strategy CRUD
- `GET/POST /api/webhooks` - Webhook CRUD
- `GET /api/webhook-logs` - Webhook execution logs
- `GET /api/webhooks/:id/status-logs` - Get webhook test status logs
- `GET /api/webhooks/:id/stats` - Get webhook statistics (success rate, avg response time)
- `POST /api/webhooks/:id/test` - Test a webhook (records response time)
- `DELETE /api/webhooks/:id/logs/cleanup` - Delete logs older than X days
- `POST /api/webhook/:id` - Receive TradingView webhook alerts
- `GET /api/webhook-registry` - Get all webhook registry entries (super admin/team only)
- `GET /api/webhook-registry/:code` - Lookup webhook by unique code from registry
- `GET /api/webhook-data` - Get all webhook data for strategies
- `GET /api/webhook-data/webhook/:webhookId` - Get webhook data by webhook ID
- `GET /api/webhook-data/strategy/:strategyId` - Get webhook data by strategy ID
- `GET /api/webhook-data/webhook/:webhookId/latest` - Get latest webhook data entry
- `PATCH /api/webhook-data/:id/processed` - Mark webhook data as processed
- `GET/POST /api/broker-configs` - Broker configuration CRUD
- `POST /api/broker-configs/:id/test` - Test broker connectivity
- `POST /api/broker-configs/:id/authenticate` - Authenticate with TOTP
- `GET /api/positions` - Open trading positions
- `GET /api/orders` - Order book
- `GET /api/holdings` - Long-term holdings
- `GET /api/portfolio-summary` - Portfolio overview

### Kotak Neo API Integration

The application implements the official Kotak Neo Trade API based on the Postman collection:

**Authentication Flow (2-step):**
1. **TOTP Login**: POST to `https://mis.kotaksecurities.com/login/1.0/tradeApiLogin`
   - Headers: `neo-fin-key: neotradeapi`, `Authorization: {consumerKey}`
   - Body: `{ mobileNumber, ucc, totp }`
   - Returns: `viewToken` and `sidView`

2. **MPIN Validate**: POST to `https://mis.kotaksecurities.com/login/1.0/tradeApiValidate`
   - Headers: `neo-fin-key: neotradeapi`, `Authorization: {consumerKey}`, `Auth: {viewToken}`, `sid: {sidView}`
   - Body: `{ mpin }`
   - Returns: `sessionToken`, `sidSession`, and `baseUrl` for trading APIs

**Trading APIs (after authentication):**
- Place Order: POST `{baseUrl}/quick/order/rule/ms/place`
- Modify Order: POST `{baseUrl}/quick/order/vr/modify`
- Cancel Order: POST `{baseUrl}/quick/order/cancel`
- Order Book: GET `{baseUrl}/quick/user/orders`
- Trade Book: GET `{baseUrl}/quick/user/trades`
- Positions: GET `{baseUrl}/quick/user/positions`
- Holdings: GET `{baseUrl}/portfolio/v1/holdings`
- Check Margin: POST `{baseUrl}/quick/user/check-margin`
- Get Limits: POST `{baseUrl}/quick/user/limits`
- Quotes: GET `{baseUrl}/script-details/1.0/quotes/neosymbol/{exchange}|{token}/all`

**Required Credentials:**
- Consumer Key (API Token) - from Neo Dashboard > Invest > Trade API
- Mobile Number - with country code (+91...)
- UCC (Unique Client Code) - from account profile
- MPIN (6-digit) - set in Neo web
- TOTP - from Google/Microsoft Authenticator (registered with Kotak)

## Design Decisions

### Color Scheme
- Dark theme optimized for trading (reduced eye strain)
- Primary: Emerald (hsl 160 84% 39%) - for positive P&L and primary actions
- Destructive: Red (hsl 0 84% 60%) - for negative P&L and sell actions
- Background: Slate dark (hsl 222 47% 11%)

### Data Storage
- **Database Name**: algo_trading (PostgreSQL)
- **Broker Credentials**: Stored permanently in PostgreSQL database (persists across restarts)
  - Stores: Consumer Key, Mobile Number, UCC, MPIN, session tokens
  - Tracks: TOTP usage (last used, time), login stats (total, successful, failed)
  - Tracks: Test stats (total, successful, last result, last message)
  - Timestamps: createdAt, updatedAt, lastConnected, lastTestTime, lastTotpTime
- **Webhooks & Logs**: Stored permanently in PostgreSQL database
  - Stores: Webhook config, secret keys, trigger counts
  - TradingView fields: exchange, indicator, alert, price, actionBinary, rsi, mode, etc.
  - Status logs: Test results, status codes, error messages
  - App settings: Domain name for auto-generated webhook URLs
- **Webhook Registry**: Central table for all webhook unique codes (past and present)
  - Stores: unique_code, webhook_id, webhook_name, created_by, is_active, deleted_at
  - Preserves historical record even after webhook deletion
  - Super admin and team members can access for tracking and lookup
  - Ensures unique codes are never reused
- **Webhook Data**: Separate database table for incoming JSON data from webhooks
  - Stores: Raw payload, parsed TradingView fields, signal type (buy/sell/hold)
  - Links to webhooks and strategies for easy data access
  - Tracks processing status (pending/processed) for automation
- **Strategies**: In-memory storage (sample data resets on restart)
- **Trading Data**: Fetched live from Kotak Neo when authenticated, mock data otherwise

## Recent Changes

### 2026-01-23
- Added email verification for customer signup using Mailjet:
  - Customers must verify email before logging in
  - Verification email sent with branded HTML template
  - 24-hour expiration on verification links
  - Auto-login after successful verification (redirects to /user-home)
  - Resend verification email endpoint: POST /api/auth/resend-verification
  - Customer login endpoint: POST /api/auth/customer/login (requires verified email)
  - Login page shows verification required state with resend option
  - Signup page shows "Check Your Email" UI after registration
  - Email service created at server/services/email.ts
- Redesigned home page with public/authenticated separation:
  - Public home page (/) now has attractive marketing layout with hero section, gradient effects
  - "How It Works" section with 3 steps (Create Webhooks, Define Strategies, Auto-Execute)
  - "Why Choose AlgoTrading" section with 6 feature cards
  - Authenticated users are automatically redirected to /user-home
  - Created new /user-home page for logged-in users with Dashboard, Strategies, Webhooks, Broker API cards
  - Quick Stats and Broker Status cards on user home
- Implemented complete authentication system with dual auth support:
  - Super Admin: Determined by email match (webadmin@mentorsworld.org)
  - Team Members: Email/Password + mandatory TOTP → HTTP-only session cookie (team_session)
  - Session tokens stored in users table with sessionToken, sessionExpires, lastLoginAt
  - Dual auth priority: Team session checked first, then Replit Auth
  - Protected routes redirect unauthenticated users to /login
  - Role-based access control: super_admin, team_member, customer roles
  - User Management page for Super Admin to invite team members
  - TOTP setup with QR code generation via speakeasy and qrcode packages
  - Password hashing via bcryptjs with strength 12
- Integrated webhook functionality from uploaded zip file:
  - Added TradingView alert fields to webhook logs (exchange, indicator, alert, price, RSI, actionBinary, etc.)
  - Created webhook receiver endpoint POST /api/webhook/:id that processes TradingView alerts
  - Added domain name configuration for auto-generating webhook URLs
  - Added test webhook functionality with status logging
  - Added webhook status logs table for tracking test results
  - Added app_settings table for storing domain name and other settings
  - Updated webhooks UI with domain configuration, test button, and status logs panel
- Enhanced webhook logging with best practices from reference implementation:
  - Added request metadata tracking (IP address, user agent) to webhook_logs
  - Added response time tracking to webhook_status_logs
  - Created webhook stats endpoint GET /api/webhooks/:id/stats with success rate and avg response time
  - Added show/hide toggle for secret keys with eye icon on webhook cards
  - Added WebhookStatsDisplay component showing success rate badges (color-coded) and response time
  - Added log cleanup endpoint DELETE /api/webhooks/:id/logs/cleanup (delete logs older than X days)
  - Fixed React Query cache invalidation to refresh stats immediately after webhook tests
- Updated INVESTMENTS tab to match Kotak Neo layout:
  - Summary cards: Current value, Total invested, Profit/Loss (with %), Today's profit/loss (with %)
  - Table columns: Name, Quantity, Avg cost, LTP, Current value, Invested, Profit/loss (%), Today's P/L (%)
  - Fixed P&L percentage calculations

### 2026-01-22
- Initial implementation of AlgoTrading Platform
- Built all 5 pages: Home, Dashboard, Strategies, Webhooks, Broker API
- Implemented complete backend with CRUD operations
- Added Zod validation for all POST and PATCH routes
- Added dark trading theme with emerald/slate color scheme
- Added data-testid attributes for testing
- Implemented Kotak Neo API client based on official Postman collection:
  - Two-step authentication: TOTP login + MPIN validation
  - Full trading API support: place/modify/cancel orders
  - Report APIs: order book, trade book, positions, holdings
  - Market data: quotes, scrip master files
  - Account APIs: margin check, limits
- Added setup guide for Kotak Neo on Broker API page
- Redesigned dashboard to match Kotak Neo layout:
  - INVESTMENTS/POSITIONS/ORDERS/PLACE ORDER tabs
  - Summary cards: Profit/Loss, Unrealised P/L, Realised P/L, Net traded value (positions)
  - Summary cards: Total P&L, Invested Value, Current Value (holdings)
  - Positions table with derivatives support (option_type, strike_price, expiry)
  - Search functionality for both positions and holdings
- Enhanced Position schema with derivatives fields and P&L breakdown
- API field mappings documented with proper fallback logic for computed values

## Running the Application

The application runs on port 5000 with:
- Frontend: Vite dev server
- Backend: Express API server

Command: `npm run dev`

## Notes

- This is adapted from a Next.js + Python trading platform
- Original project used Kotak Neo Python API and Supabase for persistence
- Current implementation uses mock data for demonstration
- For production use, would need to integrate actual broker APIs

## Webhook Linking Feature

The platform supports linking development webhooks to production webhook data streams:

- **Link to Production**: Click the chain link icon on any webhook card to link it to a production webhook
- **Enter ID directly**: Manually enter the production webhook ID if you know it
- **Select from existing**: Choose from existing webhooks in the dropdown
- **Visual Indicator**: Linked webhooks show a "Linked" badge in their title
- **Unlink**: Click the unlink icon (green chain) to remove the link
- **Data Fetching**: When viewing data for a linked webhook, it shows data from the linked (production) webhook

This feature enables development testing with live production data streams without modifying production webhooks
