# Changelog

All notable changes to PriceGhost will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-01-23

### Added

#### Core Features
- Universal price scraping with site-specific extractors for Amazon, Walmart, Best Buy, Target, eBay, Newegg, Home Depot, Costco, and AliExpress
- JSON-LD structured data extraction for broad site compatibility
- Puppeteer headless browser fallback with stealth plugin for JavaScript-rendered pages
- Price history tracking with interactive charts (7d, 30d, 90d, all time)
- 7-day sparkline graphs on dashboard for quick trend overview
- Configurable check intervals (5 minutes to 24 hours)
- Live countdown timers and progress bars showing time until next check
- Staggered checking with jitter to prevent rate limiting

#### AI Features
- AI-powered price extraction fallback (Anthropic Claude, OpenAI GPT, Ollama local)
- AI price verification to catch scraping errors (e.g., scraping savings amounts instead of actual prices)
- AI status badges showing verification status (✓ verified, ⚡ corrected)

#### Notifications
- Telegram bot notifications
- Discord webhook notifications
- Pushover push notifications
- ntfy.sh notifications (no account required)
- Price drop alerts with configurable thresholds
- Target price alerts
- Back-in-stock alerts
- Per-channel enable/disable toggles
- Test notification buttons for each channel

#### Stock Tracking
- Out-of-stock detection with visual indicators
- Stock status history tracking
- Stock timeline visualization
- Back-in-stock notification alerts

#### User Interface
- Dark/Light mode with system theme auto-detection
- Responsive design for desktop and mobile
- Toast notifications for user feedback
- Dashboard with list layout, search, and sorting
- Bulk actions (select multiple products, bulk delete)
- Historical low price indicators
- Product notification badges showing configured alerts

#### User Management
- Multi-user support with JWT authentication
- Admin panel for user management
- Registration enable/disable control
- Profile management (name, password)
- Password visibility toggle for sensitive fields

#### PWA & Mobile
- Progressive Web App support
- Add to Home Screen capability
- Service worker for offline caching
- Custom ghost icon

#### Currency Support
- USD, EUR, GBP, CHF, CAD, AUD, JPY, INR support
- Automatic currency detection from scraped pages

#### Deployment
- Docker and Docker Compose support
- GitHub Container Registry images
- GitHub Actions CI/CD workflow

### Security
- JWT-based authentication
- bcrypt password hashing
- Input validation throughout
- Secure API design

---

## Version History

| Version | Date | Description |
|---------|------|-------------|
| 1.0.0 | 2026-01-23 | Initial public release |
