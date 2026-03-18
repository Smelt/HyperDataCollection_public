# Hyperliquid Data Collection

A TypeScript-based data collection system for Hyperliquid DEX featuring:
- Real-time spread monitoring and data collection
- Smart pair filtering (tracks most profitable pairs)
- Database storage for historical analysis
- REST API for trading signals
- Grafana dashboards for visualization

## Features

- **Automatic discovery of all Hyperliquid perpetuals** - Monitor all available markets with a single setting
- Real-time order book monitoring via WebSocket or REST API
- Multi-pair spread tracking and analysis
- Automated CSV data logging with daily organization
- Live CLI dashboard with spread statistics
- Profitability analysis after fees
- JSON summary exports for historical analysis
- Configurable monitoring intervals and pairs

## Quick Start

### Installation

```bash
# Install dependencies
npm install

# Copy environment configuration
cp .env.example .env

# Edit .env to customize settings (optional)
nano .env
```

### Running

```bash
# Development mode - monitors ALL perpetuals by default
npm run dev

# Production mode
npm run build
npm start

# Monitor specific pairs only
PAIRS=REZ,SOL,BTC npm run dev

# Monitor all available perpetuals (default)
PAIRS=all npm run dev
```

## Deployment

### Deploy to a Server

**Key deployment scripts:**
```bash
# Setup fresh instance
./scripts/ec2-setup.sh

# Deploy application
./scripts/deploy-to-ec2.sh <ssh-key.pem> <server-ip>

# Database maintenance
./scripts/migrate.sh    # Run database migrations
./scripts/backup.sh     # Create database backup
./scripts/cleanup.sh    # Clean old data
```

## Configuration

### Environment Variables (.env)

```env
# Hyperliquid API Configuration
HYPERLIQUID_API_URL=https://api.hyperliquid.xyz
HYPERLIQUID_WS_URL=wss://api.hyperliquid.xyz/ws

# Monitoring Configuration
SNAPSHOT_INTERVAL_MS=1000           # Data collection interval
PAIRS=all                           # "all" for all perpetuals, or comma-separated: REZ,SOL,BTC,ETH,ATOM
LOG_LEVEL=info                      # Logging level

# Data Storage
DATA_DIR=./data                     # Data storage directory
ENABLE_CSV_LOGGING=true             # Enable CSV logging
ENABLE_JSON_SUMMARY=true            # Enable JSON summaries

# Fee Configuration (for profitability calculations)
MAKER_FEE_BPS=1.5                  # 0.015% = 1.5 bps (Tier 0)
TAKER_FEE_BPS=4.5                  # 0.045% = 4.5 bps
```

**PAIRS Configuration Options:**
- `PAIRS=all` - Automatically discovers and monitors ALL available Hyperliquid perpetuals (default)
- `PAIRS=REZ,SOL,BTC` - Monitor only specific pairs (comma-separated, no spaces)

### Automatic Perpetual Discovery

When `PAIRS=all` is set (default), the application will:

1. **Connect to Hyperliquid API** at startup
2. **Fetch all available perpetuals** using the `/info` endpoint with `type: "meta"`
3. **Automatically monitor** every discovered perpetual contract
4. **Display the count** of perpetuals being monitored (e.g., "Found 147 perpetuals to monitor")

This ensures you never miss new markets as Hyperliquid adds them!

### Manual Trading Pairs Configuration

If you prefer to monitor specific pairs only, set `PAIRS` to a comma-separated list in `.env`:

```env
PAIRS=REZ,SOL,BTC,ETH,ATOM
```

Alternatively, edit `src/config/pairs.ts` for more advanced configuration (only used when PAIRS is not set in `.env`):

```typescript
export const PAIRS: PairConfig[] = [
  {
    symbol: 'REZ',
    minSpread: 0.08,      // Minimum "good" spread %
    targetVolume: 1000000, // Target daily volume
    enabled: true
  },
  // Add more pairs...
];
```

## Data Storage

### Directory Structure

```
data/
├── 2025-10-19/
│   ├── REZ_orderbook.csv
│   ├── SOL_orderbook.csv
│   ├── BTC_orderbook.csv
│   └── summary_stats.json
├── 2025-10-20/
│   └── ...
```

### CSV Format

Each CSV file contains:

| Column | Description |
|--------|-------------|
| timestamp | ISO 8601 timestamp |
| pair | Trading pair symbol |
| best_bid | Best bid price |
| best_ask | Best ask price |
| bid_size | Size at best bid |
| ask_size | Size at best ask |
| spread_bps | Spread in basis points |
| spread_pct | Spread percentage |
| mid_price | Mid price |
| book_imbalance | Order book imbalance ratio |

## Dashboard

The CLI dashboard displays:

- **Uptime & Data Points**: Monitor runtime and collection progress
- **Real-time Spreads**: Current spread for each pair
- **Time-windowed Averages**: 5-minute and 1-hour averages
- **Best Bid/Ask**: Current top of book prices
- **Status Indicators**:
  - `✓ Good` - Spread above minimum threshold
  - `⚠ Tight` - Spread below minimum threshold
  - `↑ Wide` - Spread significantly above threshold
- **Top Opportunities**: Ranked by profitability after fees

## API Reference

### HyperliquidAPI

```typescript
const api = new HyperliquidAPI('https://api.hyperliquid.xyz');

// Get all available perpetuals (NEW!)
const allPerpetuals = await api.getAllPerpetuals();
// Returns: ['BTC', 'ETH', 'SOL', 'REZ', ...]

// Get L2 order book
const orderBook = await api.getL2OrderBook('REZ');

// Get 24h volume
const volume = await api.get24hVolume('REZ');

// Get all available pairs metadata
const meta = await api.getMeta();
```

### OrderBookMonitor

```typescript
const monitor = new OrderBookMonitor(apiUrl, wsUrl, pairs, intervalMs);

// Register callback for spread data
monitor.onSpreadData((data: SpreadData) => {
  console.log(`${data.pair}: ${data.spreadPct}%`);
});

// Start monitoring
await monitor.start();
```

### StatisticsCalculator

```typescript
const stats = new StatisticsCalculator(dataDir);

// Add data point
stats.addDataPoint(spreadData);

// Get statistics for a pair
const pairStats = stats.calculateStats('REZ');

// Identify opportunities
const opportunities = stats.identifyOpportunities(makerFeeBps);
```

## Analysis

### Key Metrics Tracked

1. **Spread Consistency**: Standard deviation of spreads over time
2. **Time-based Averages**: 5-minute, 1-hour, and overall averages
3. **Profitability**: Spread minus 2x maker fees
4. **Order Book Imbalance**: (Bid Volume - Ask Volume) / Total Volume
5. **Min/Max Spreads**: Range of observed spreads

### Analyzing Collected Data

After running for 24-72 hours, use the CSV data to answer:

- What is the average spread for each pair?
- How consistent are spreads? (lower std dev = more consistent)
- Which times of day have the widest spreads?
- What's the correlation between volume and spread?
- Which pairs offer the best risk-adjusted returns?

### Example Analysis with Python/Pandas

```python
import pandas as pd

# Load data
df = pd.read_csv('data/2025-10-19/REZ_orderbook.csv')

# Calculate hourly statistics
df['timestamp'] = pd.to_datetime(df['timestamp'])
df['hour'] = df['timestamp'].dt.hour

hourly_stats = df.groupby('hour')['spread_pct'].agg(['mean', 'std', 'min', 'max'])
print(hourly_stats)
```

## Project Structure

```
hyperliquid-market-maker/
├── src/
│   ├── api/
│   │   ├── hyperliquid.ts          # REST API client
│   │   └── websocket.ts            # WebSocket manager
│   ├── monitors/
│   │   ├── orderbook.ts            # Order book monitor
│   │   └── spread.ts               # Spread calculator
│   ├── storage/
│   │   ├── csv-logger.ts           # CSV data logger
│   │   └── stats.ts                # Statistics calculator
│   ├── display/
│   │   └── dashboard.ts            # CLI dashboard
│   ├── types/
│   │   └── index.ts                # TypeScript interfaces
│   ├── config/
│   │   ├── index.ts                # Config loader
│   │   └── pairs.ts                # Trading pairs config
│   └── index.ts                    # Main entry point
├── data/                            # Generated data files
├── .env                             # Environment config
├── package.json
├── tsconfig.json
└── README.md
```

## Troubleshooting

### WebSocket Connection Issues

If WebSocket connection fails, the monitor automatically falls back to REST API polling.

```
Failed to start WebSocket monitoring: Error: ...
Falling back to polling...
```

### Rate Limiting

If you encounter rate limiting:
1. Increase `SNAPSHOT_INTERVAL_MS` in `.env`
2. Reduce the number of monitored pairs
3. Ensure proper error handling and exponential backoff

### No Data Appearing

1. Check that pairs are valid Hyperliquid symbols
2. Verify API connectivity: `curl https://api.hyperliquid.xyz/info`
3. Check logs for error messages
4. Ensure `data/` directory is writable

## Resources

- [Hyperliquid API Documentation](https://hyperliquid.gitbook.io/hyperliquid-docs/)
- [Hyperliquid Stats](https://stats.hyperliquid.xyz)
- [Fee Structure](https://hyperliquid.gitbook.io/hyperliquid-docs/trading/fees)

## Trading Features (In Development)

The bot is being enhanced with automated trading capabilities:

- ✅ Order placement and execution (tested)
- 🔄 Opportunistic spread crossing strategy
- 🔄 Active order management (stay first in line)
- 🔄 Position tracking and PnL calculation
- 🔄 Risk controls and safety limits
- 📋 Backtesting framework
- 📋 Multi-position management

## License

MIT

## Disclaimer

This tool is for educational and research purposes only. Market making involves significant financial risk. Always understand the risks before trading with real capital.
