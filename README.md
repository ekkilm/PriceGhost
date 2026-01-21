# PriceGhost 👻

A self-hosted price tracking application that monitors product prices across major retailers. Get notified when prices drop or items come back in stock.

## Features

### Price Tracking
- **Universal scraping** - Works with Amazon, Newegg, Walmart, Best Buy, Target, eBay, Home Depot, Costco, AliExpress, and any site with standard price markup
- **Smart price detection** - Uses multiple strategies: site-specific selectors, JSON-LD structured data, and intelligent heuristics
- **Price history charts** - Interactive visualization with customizable date ranges (7d, 30d, 90d, all time)
- **7-day sparklines** - Quick price trend overview on the dashboard
- **Configurable check intervals** - From 30 minutes to 24 hours per product

### Notifications
- **Telegram alerts** - Get notified via Telegram bot when prices drop
- **Discord webhooks** - Send alerts to any Discord channel
- **Per-product thresholds** - Set custom price drop amounts (e.g., "notify me when it drops $10+")
- **Back-in-stock alerts** - Get notified when out-of-stock items become available

### Stock Tracking
- **Out-of-stock detection** - Automatically detects when products are unavailable
- **Visual indicators** - Clear badges showing stock status on dashboard and detail pages
- **Stock history** - Track when items go in and out of stock

### User Experience
- **Dark/Light mode** - System-aware theme with manual toggle
- **Responsive design** - Works on desktop and mobile
- **Manual refresh** - Force an immediate price check with one click
- **Dashboard notifications** - See which products have alerts configured at a glance

## Tech Stack

| Layer | Technology |
|-------|------------|
| **Frontend** | React 18, TypeScript, Vite |
| **Backend** | Node.js, Express, TypeScript |
| **Database** | PostgreSQL 16 |
| **Scraping** | Cheerio, Axios |
| **Charts** | Recharts |
| **Auth** | JWT + bcrypt |
| **Scheduling** | node-cron |
| **Containerization** | Docker, Docker Compose |
| **CI/CD** | GitHub Actions |

## Supported Retailers

Optimized scrapers for:
- Amazon (US, UK, CA, DE, FR, ES, IT, JP, IN, AU)
- Newegg
- Walmart
- Best Buy
- Target
- eBay
- Home Depot
- Costco
- AliExpress

Generic scraping works on most other e-commerce sites.

## Quick Start

### Docker (Recommended)

```bash
# Clone the repository
git clone https://github.com/clucraft/PriceGhost.git
cd PriceGhost

# Start all services
docker-compose up -d

# Access at http://localhost:8089 (or your configured port)
```

### Environment Variables

Create a `.env` file or set these in your environment:

```env
# Database
POSTGRES_USER=postgres
POSTGRES_PASSWORD=your_secure_password
POSTGRES_DB=priceghost

# Backend
JWT_SECRET=your_jwt_secret_here
DATABASE_URL=postgresql://postgres:password@db:5432/priceghost

# Frontend (optional)
VITE_API_URL=/api
```

## Development Setup

### Prerequisites
- Node.js 20+
- PostgreSQL 16+

### Backend

```bash
cd backend
npm install
cp .env.example .env  # Edit with your database credentials
npm run dev
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

## API Reference

### Authentication
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/register` | Create account |
| POST | `/api/auth/login` | Login, returns JWT |

### Products
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/products` | List all tracked products |
| POST | `/api/products` | Add product by URL |
| GET | `/api/products/:id` | Get product details + stats |
| PUT | `/api/products/:id` | Update settings/notifications |
| DELETE | `/api/products/:id` | Stop tracking product |

### Prices
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/products/:id/prices` | Get price history |
| POST | `/api/products/:id/refresh` | Force immediate price check |

### Settings
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/settings/notifications` | Get notification config |
| PUT | `/api/settings/notifications` | Update Telegram/Discord settings |
| POST | `/api/settings/notifications/test/telegram` | Send test notification |
| POST | `/api/settings/notifications/test/discord` | Send test notification |

## Project Structure

```
PriceGhost/
├── backend/
│   └── src/
│       ├── config/         # Database connection
│       ├── middleware/     # JWT authentication
│       ├── models/         # Database queries
│       ├── routes/         # API endpoints
│       ├── services/       # Scraper, scheduler, notifications
│       └── utils/          # Price parsing
├── frontend/
│   └── src/
│       ├── api/            # Axios client
│       ├── components/     # Reusable components
│       ├── context/        # Auth context
│       ├── hooks/          # Custom hooks
│       └── pages/          # Page components
├── database/
│   └── init.sql            # Schema + migrations
├── docker-compose.yml
└── .github/workflows/      # CI/CD
```

## Rate Limiting & Best Practices

To avoid getting blocked by retailers:

- **Staggered checking** - Products are checked at randomized intervals with ±5 minute jitter
- **Request delays** - 2-5 second random delay between checking different products
- **Reasonable intervals** - Default 1 hour; use longer intervals (4-6 hours) if tracking many products
- **User-Agent rotation** - Requests use standard browser headers

## Setting Up Notifications

### Telegram
1. Create a bot via [@BotFather](https://t.me/botfather) on Telegram
2. Get your Chat ID from [@userinfobot](https://t.me/userinfobot)
3. Enter both in Settings → Telegram Notifications

### Discord
1. In your Discord server: Server Settings → Integrations → Webhooks
2. Create a new webhook and copy the URL
3. Enter the URL in Settings → Discord Notifications

---

## About This Project

This project was built collaboratively with [Claude](https://claude.ai) (Anthropic's AI assistant) using [Claude Code](https://claude.ai/claude-code). Every feature, from the initial architecture to the scraping heuristics to the notification system, was developed through iterative conversation and code generation.

**This isn't typical "AI slop."** Each component was thoughtfully designed, tested against real product pages, and refined based on actual usage. The codebase follows consistent patterns, handles edge cases properly, and includes real-world considerations like rate limiting and anti-bot detection avoidance.

Built with Claude Opus 4.5.

## License

MIT
