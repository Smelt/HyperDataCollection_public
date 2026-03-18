# Hyperliquid Data Collection

A production-grade, real-time market data pipeline for [Hyperliquid DEX](https://hyperliquid.xyz). Collects orderbook snapshots across 200+ perpetual markets at 5-second intervals, intelligently filters for the most profitable pairs, and serves trading signals through a REST API — powering an [automated trading bot](https://github.com/Smelt/hyperliquid-trading-bot) in a separate repo.

Built with TypeScript, WebSockets, MySQL, and Express. Deployed on AWS EC2 with Grafana dashboards for monitoring.

## Architecture

```
Hyperliquid WebSocket (L2 orderbooks)          Deribit API (options IV)
         │                                              │
         ▼                                              ▼
┌─────────────────────┐                    ┌────────────────────────┐
│  OrderBookMonitor   │                    │  IV Collector          │
│  (real-time stream) │                    │  (5-min polling)       │
└────────┬────────────┘                    └───────────┬────────────┘
         │                                             │
         ▼                                             │
┌─────────────────────┐    ┌────────────────────┐      │
│  SpreadCalculator   │    │ TradeSizeCollector  │      │
│  (bid-ask analysis) │    │ (separate WS stream)│      │
└────────┬────────────┘    └─────────┬──────────┘      │
         │                           │                  │
         ▼                           ▼                  ▼
┌──────────────────────────────────────────────────────────────┐
│                    DatabaseLogger                             │
│            (batched writes: 100 rows / 5s flush)             │
└──────────────────────────┬───────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────┐
│                       MySQL (RDS)                            │
│                                                              │
│  spread_snapshots (raw, 7-day TTL)     ~864K rows/day/pair  │
│  spread_stats_hourly (permanent)       ~1.2K rows/day       │
│  trade_sizes (partitioned, 7-day TTL)  ~500K-1M trades/day  │
│  btc_implied_volatility (rolling)      288 rows/day         │
│  trading_signals (30-day TTL)                                │
│  request_metrics                                             │
└──────────────────────────┬───────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────┐
│                   REST API (Express)                         │
│                                                              │
│  /api/spread/:pair/current      Live spread data             │
│  /api/spread/:pair/opportunity  Deviation-based signals      │
│  /api/volatility/:pair          Market state classification  │
│  /api/btc-iv/should-trade       Risk gate (IV-based)         │
│  /api/trades/:pair/size-stats   Position sizing              │
│  /api/market/snapshot           All-pairs overview           │
│  ... 25+ endpoints total                                     │
└──────────────────────────┬───────────────────────────────────┘
                           │
                           ▼
                   External Trading Bot
```

## Key Engineering Decisions

### Smart Pair Filtering

Can't efficiently monitor all 200+ perpetuals on limited bandwidth. The `PairFilterService` runs hourly discovery scans — fetches spreads for every pair, ranks by profitability after fees, and tracks only the top N most profitable. When the pair set changes, it restarts the monitor automatically. This cuts network I/O by ~90%.

### Batched Database Writes

At 5-second intervals across 18 pairs, individual INSERTs would mean 864K writes/day per pair. The `DatabaseLogger` buffers snapshots in memory (batch size: 100, auto-flush every 5s) and writes them as a single multi-row INSERT. Failed batches are re-queued with a memory safety cap at 1000 items. Result: 12x fewer database operations.

### Market State Classification

The `/api/volatility/:pair` endpoint calculates a **spread-to-volatility ratio** to classify markets into four states:

| State | Ratio | Meaning |
|-------|-------|---------|
| `IDEAL` | >= 2.0 | High spread, low volatility — best conditions |
| `FAVORABLE` | >= 1.0 | Spread captures price moves |
| `CHOPPY` | < 1.0 | Volatility exceeds spread |
| `DANGEROUS` | — | Extreme volatility (>100 bps stddev) |

Thresholds derived from backtesting 404 trades: **78.4% win rate** when ratio >= 1.0 vs 56.6% below.

### Implied Volatility Risk Gate

Integrates with Deribit's options market to fetch BTC implied volatility (DVOL, short-term IV, term structure). The `/api/btc-iv/should-trade` endpoint returns a simple boolean — prevents the trading bot from entering positions during high-vol events (Fed announcements, CPI releases, etc.). Flags risk when IV > 60%, backwardation > 10%, or expected daily move > 4%.

### Dual WebSocket Streams

Two independent WebSocket connections: one for L2 orderbook updates (spread calculation), one for individual trades (position sizing). Each has its own reconnection logic with exponential backoff. If trade collection fails, spread monitoring continues unaffected.

## Tech Stack

- **Runtime:** TypeScript / Node.js (ES2022, strict mode)
- **Data Ingestion:** WebSocket (ws) + REST polling
- **Database:** MySQL 8.0+ with connection pooling (mysql2)
- **API Server:** Express 5.x
- **Infrastructure:** AWS EC2 (Tokyo) + RDS
- **Monitoring:** Grafana (20+ dashboards) + Loki log aggregation
- **Process Management:** PM2 (auto-restart, log rotation)

## REST API

### Spread Analysis
```
GET /api/market/snapshot              All pairs: latest, avg, median, P75, P90
GET /api/spread/:pair/current         Current spread for a pair
GET /api/spread/:pair/average?hours=1 Time-windowed averages with min/max/stddev
GET /api/spread/:pair/opportunity     Deviation-based trading signals
```

### Volatility & Risk
```
GET /api/volatility/:pair?window=10   Market state + trading recommendation
GET /api/btc-iv                       BTC implied volatility (DVOL, term structure)
GET /api/btc-iv/should-trade          Boolean risk gate for trading bot
GET /api/btc-iv/history?hours=24      Historical IV data
```

### Position Sizing
```
GET /api/trades/:pair/size-stats      Percentile-based size recommendations
GET /api/trades/:pair/recommended-size  P25 size capped at max notional
GET /api/trades/:pair/volume          Activity check (avoid dead markets)
```

### Metrics
```
POST /api/metrics/requests            Record API usage by executor
GET  /api/metrics/requests/summary    Aggregated usage stats
GET  /api/metrics/requests/timeseries Time-series for charting
```

## Database Schema

9 migrations manage the schema evolution:

| Table | Retention | Purpose | Scale |
|-------|-----------|---------|-------|
| `spread_snapshots` | 7 days | Raw orderbook snapshots | ~864K rows/day/pair |
| `spread_stats_hourly` | Permanent | Aggregated statistics | ~1.2K rows/day |
| `trade_sizes` | 7 days (partitioned) | Individual trades for sizing | ~500K-1M/day |
| `btc_implied_volatility` | Rolling | Deribit IV snapshots | 288 rows/day |
| `btc_iv_hourly` | Permanent | IV aggregates (OHLC) | 24 rows/day |
| `trading_signals` | 30 days | Generated signals | Variable |
| `request_metrics` | Rolling | API call tracking | Variable |
| `rate_limit_snapshots` | Rolling | Hyperliquid rate limit usage | 1440/day |
| `user_trades` | Permanent | Historical fills | Variable |

Key optimizations: date-based partitioning on `trade_sizes`, composite indexes on `(pair, timestamp)`, multi-row INSERT with ON DUPLICATE KEY UPDATE.

## Quick Start

```bash
# Install dependencies
npm install

# Copy environment configuration
cp .env.example .env
# Edit .env with your database credentials and wallet address

# Development mode
npm run dev

# Production mode
npm run build && npm start

# Monitor specific pairs only
PAIRS=BTC,ETH,SOL npm run dev
```

## Configuration

See `.env.example` for all options. Key settings:

```env
PAIRS=all                       # "all" or comma-separated: BTC,ETH,SOL
SNAPSHOT_INTERVAL_MS=5000       # Collection frequency
ENABLE_SMART_FILTERING=true     # Auto-discover profitable pairs
MIN_PROFIT_BPS=10               # Minimum spread after fees
MAX_PAIRS=20                    # Max pairs to track simultaneously
```

## Project Structure

```
src/
├── api/
│   ├── hyperliquid.ts              # REST client (orderbooks, metadata, trades)
│   ├── websocket.ts                # WebSocket manager (reconnection, heartbeats)
│   └── spread-api.ts               # Express REST server (25+ endpoints)
├── monitors/
│   ├── orderbook.ts                # Real-time orderbook aggregator
│   └── spread.ts                   # Spread calculation engine
├── services/
│   ├── pair-filter.ts              # Smart pair discovery & ranking
│   ├── trade-size-collector.ts     # WebSocket trade stream consumer
│   ├── deribit-iv.ts               # Implied volatility fetcher
│   └── iv-collector.ts             # IV polling scheduler
├── storage/
│   ├── database.ts                 # Connection pooling + health checks
│   ├── db-logger.ts                # Batched write engine
│   ├── snapshot-repo.ts            # Spread snapshot queries
│   ├── stats-repo.ts               # Aggregated statistics queries
│   ├── signal-repo.ts              # Trading signal storage
│   ├── trade-size-repo.ts          # Trade data queries
│   └── stats-calculator.ts         # Rolling statistics (5m/1h windows)
├── display/
│   └── dashboard.ts                # Real-time CLI visualization
├── config/                         # Environment-driven configuration
├── types/                          # TypeScript type definitions
└── index.ts                        # Main orchestrator & lifecycle manager
scripts/                            # Deployment, migration, backup automation
database/migrations/                # 9 versioned schema migrations
grafana/                            # 20+ dashboard JSON configs
```

## Deployment

```bash
# Setup a fresh server
./scripts/ec2-setup.sh

# Deploy application
./scripts/deploy-to-ec2.sh <ssh-key.pem> <server-ip>

# Database operations
./scripts/migrate.sh     # Apply schema migrations
./scripts/backup.sh      # Create database backup
./scripts/cleanup.sh     # Enforce data retention (runs daily via cron)
```

## License

MIT

## Disclaimer

This software is for educational and research purposes. Trading involves significant financial risk. Understand the risks before using with real capital.
