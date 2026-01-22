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
- `GET/POST /api/broker-configs` - Broker configuration CRUD
- `GET /api/positions` - Open trading positions
- `GET /api/orders` - Order book
- `GET /api/holdings` - Long-term holdings
- `GET /api/portfolio-summary` - Portfolio overview

## Design Decisions

### Color Scheme
- Dark theme optimized for trading (reduced eye strain)
- Primary: Emerald (hsl 160 84% 39%) - for positive P&L and primary actions
- Destructive: Red (hsl 0 84% 60%) - for negative P&L and sell actions
- Background: Slate dark (hsl 222 47% 11%)

### Data
- Uses mock trading data for demonstration
- Sample strategies: NIFTY Momentum, Bank NIFTY Scalper
- Sample broker: Kotak Neo (pre-configured)

## Recent Changes

### 2026-01-22
- Initial implementation of AlgoTrading Platform
- Built all 5 pages: Home, Dashboard, Strategies, Webhooks, Broker API
- Implemented complete backend with CRUD operations
- Added Zod validation for all POST and PATCH routes
- Added dark trading theme with emerald/slate color scheme
- Added data-testid attributes for testing

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
