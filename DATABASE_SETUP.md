# Database Setup Guide

This guide covers setting up and using the database features for the Hyperliquid Market Making Bot.

## Prerequisites

- MySQL 5.7+ or 8.0+
- Node.js 18+
- Access to a MySQL server (local or remote)

## Quick Start

### 1. Configure Database Credentials

Copy the example environment file and configure your database credentials:

```bash
cp .env.example .env
```

Edit `.env` and update the database section:

```env
# Database Configuration
DB_HOST=localhost
DB_PORT=3306
DB_USER=your_mysql_user
DB_PASSWORD=your_mysql_password
DB_NAME=Crypto

# Enable database logging
ENABLE_DB_LOGGING=true
```

### 2. Create Database and Run Migrations

Run the setup script to create the database and apply migrations:

```bash
./scripts/setup-db.sh
```

This will:
- Create the database if it doesn't exist
- Run all migrations
- Verify the database is ready

**Expected output:**
```
=========================================
  Initial Database Setup
=========================================
Database Configuration:
  Host: localhost
  Port: 3306
  User: root
  Database: Crypto

Testing database connection...
✓ Connected to MySQL server

Creating database: Crypto
✓ Database created

Running migrations...
=========================================
  Database Migration Runner
=========================================
Current schema version: 0

Applying migration 1: 001_initial_schema.sql
✓ Migration 1 applied successfully

Successfully applied 1 migration(s)

=========================================
✓ Database setup complete!
=========================================
```

### 3. Start the Application

```bash
npm start
```

You should see:
```
Starting Hyperliquid Market Making Monitor...
Monitoring 4 pairs: REZ, SOL, BTC, ETH
Data directory: ./data
CSV logging: enabled
JSON summary: enabled
Database logging: enabled
Testing database connection...
✓ Database connection established
```

## Database Schema

The database contains 4 main tables:

### 1. `spread_snapshots` (7-day retention)
Stores raw spread data collected every 5 seconds.

**Key columns:**
- `timestamp` - Unix timestamp in milliseconds
- `pair` - Trading pair (REZ, SOL, etc.)
- `best_bid`, `best_ask` - Top of book prices
- `spread_pct`, `spread_bps` - Calculated spreads
- `bid_size`, `ask_size` - Sizes at top of book
- `mid_price`, `imbalance` - Derived metrics

**Usage:** Real-time analysis, calculating statistics

### 2. `spread_stats_hourly` (permanent)
Hourly aggregated statistics - this is your historical baseline.

**Key columns:**
- `hour_timestamp` - Start of hour (Unix ms)
- `pair` - Trading pair
- `avg_spread`, `min_spread`, `max_spread` - Spread statistics
- `std_dev`, `median_spread` - Distribution metrics
- `sample_count` - Number of snapshots used
- `avg_volume` - Average order book volume

**Usage:** Historical analysis, trend detection

### 3. `trading_signals` (30-day retention)
Generated trading signals when conditions are met.

**Key columns:**
- `timestamp` - Signal generation time
- `pair` - Trading pair
- `signal_type` - ENTER, EXIT, or HOLD
- `current_spread` - Spread when signal generated
- `avg_spread_1h`, `avg_spread_24h` - Historical averages
- `confidence` - Signal confidence (0-100)
- `expected_profit` - Theoretical profit in bps
- `reasoning` - Text explanation

**Usage:** Future automated trading, backtesting

### 4. `schema_migrations`
Tracks which migrations have been applied.

## Data Collection

### How It Works

1. **Real-time Collection** (every 5 seconds):
   - WebSocket receives order book updates
   - Spread calculator processes data
   - Database logger batches and saves to `spread_snapshots`

2. **Hourly Aggregation** (every hour):
   - Stats calculator queries last hour's snapshots
   - Calculates avg, min, max, std dev, median
   - Saves to `spread_stats_hourly`

3. **Automatic Cleanup** (daily at 2 AM):
   - Deletes snapshots older than 7 days
   - Deletes signals older than 30 days
   - Optimizes tables

### Batching Strategy

Database logger uses intelligent batching to minimize database load:

- **Batch size**: 100 snapshots
- **Batch timeout**: 5 seconds
- **Auto-retry**: Failed batches are retried
- **Memory safety**: Buffer capped at 1000 items

With 4 pairs at 5-second intervals:
- ~48 snapshots/minute
- Flush every ~2 minutes or 5 seconds (whichever comes first)
- ~69,000 inserts/day (very manageable)

## Maintenance

### Daily Cleanup

Run manually:
```bash
./scripts/cleanup.sh
```

Or schedule with cron:
```bash
# Run daily at 2 AM
0 2 * * * cd /path/to/project && ./scripts/cleanup.sh >> /var/log/hyperliquid-cleanup.log 2>&1
```

**What it does:**
- Removes snapshots older than 7 days
- Removes signals older than 30 days
- Optimizes tables for better performance
- Shows database size

### Backups

Create a backup:
```bash
./scripts/backup.sh
```

Schedule daily backups:
```bash
# Run daily at 3 AM
0 3 * * * cd /path/to/project && ./scripts/backup.sh >> /var/log/hyperliquid-backup.log 2>&1
```

**Backup features:**
- Compressed with gzip
- 7-day automatic rotation
- Includes all tables and data
- Transactionally consistent

**Restore from backup:**
```bash
gunzip < backups/hyperliquid_20251019_030000.sql.gz | mysql -u root -p Crypto
```

### Monitoring

#### Check Data Collection Health

```sql
-- See collection rate per pair (should be ~720 per hour)
SELECT
  pair,
  COUNT(*) as snapshot_count,
  MIN(FROM_UNIXTIME(timestamp/1000)) as oldest,
  MAX(FROM_UNIXTIME(timestamp/1000)) as newest,
  TIMESTAMPDIFF(SECOND,
    MIN(FROM_UNIXTIME(timestamp/1000)),
    MAX(FROM_UNIXTIME(timestamp/1000))
  ) / COUNT(*) as avg_interval_seconds
FROM spread_snapshots
WHERE timestamp > UNIX_TIMESTAMP(DATE_SUB(NOW(), INTERVAL 1 HOUR)) * 1000
GROUP BY pair;
```

#### Check Database Size

```sql
SELECT
  table_name,
  ROUND(((data_length + index_length) / 1024 / 1024), 2) AS size_mb,
  table_rows
FROM information_schema.TABLES
WHERE table_schema = 'Crypto'
ORDER BY (data_length + index_length) DESC;
```

#### Find Data Gaps

```sql
-- Check for hours with low sample counts
SELECT
  pair,
  DATE_FORMAT(FROM_UNIXTIME(hour_timestamp/1000), '%Y-%m-%d %H:00') as hour,
  sample_count
FROM spread_stats_hourly
WHERE hour_timestamp > UNIX_TIMESTAMP(DATE_SUB(NOW(), INTERVAL 7 DAY)) * 1000
  AND sample_count < 600  -- Expected ~720 snapshots/hour
ORDER BY hour_timestamp DESC;
```

## Troubleshooting

### "Cannot connect to database"

**Check MySQL is running:**
```bash
mysql -u root -p -e "SELECT 1"
```

**Verify credentials in .env:**
```bash
# Test connection with env vars
mysql -h$DB_HOST -u$DB_USER -p$DB_PASSWORD -e "SELECT 1"
```

### "Table doesn't exist"

**Run migrations:**
```bash
./scripts/migrate.sh
```

**Check migration status:**
```bash
mysql -u root -p Crypto -e "SELECT * FROM schema_migrations"
```

### Slow Queries

**Check indexes exist:**
```sql
SHOW INDEX FROM spread_snapshots;
```

**Add missing indexes if needed:**
```sql
CREATE INDEX idx_pair_timestamp ON spread_snapshots(pair, timestamp);
```

### Application crashes with database errors

**Disable database logging temporarily:**
```env
ENABLE_DB_LOGGING=false
```

**Check MySQL error log:**
```bash
# macOS Homebrew
tail -f /usr/local/var/mysql/*.err

# Linux
tail -f /var/log/mysql/error.log
```

## Configuration Options

### Environment Variables

```env
# Database connection
DB_HOST=localhost                    # MySQL server host
DB_PORT=3306                         # MySQL server port
DB_USER=root                         # Database user
DB_PASSWORD=                         # Database password
DB_NAME=Crypto              # Database name

# Data collection
SNAPSHOT_INTERVAL_MS=5000            # Collection frequency (5 seconds)
STATS_CALCULATION_INTERVAL_MS=3600000 # Stats calculation (1 hour)
ENABLE_DB_LOGGING=true               # Enable/disable database logging

# Cleanup & maintenance
CLEANUP_INTERVAL_HOURS=24            # How often to run cleanup
BACKUP_DIR=./backups                 # Backup directory
BACKUP_ENABLED=true                  # Enable automatic backups
```

### Retention Policies

Configured in `src/config/database.ts`:

```typescript
retention: {
  snapshots: 7 * 24 * 60 * 60 * 1000,    // 7 days
  signals: 30 * 24 * 60 * 60 * 1000,      // 30 days
  hourlyStats: Infinity                    // Forever
}
```

## Performance Considerations

### Expected Storage

With 50 pairs collecting data:

| Table | Rate | Daily Volume | Weekly Storage |
|-------|------|--------------|----------------|
| spread_snapshots | 50 pairs × 720/hour | ~864,000 rows | ~6M rows (~2-5 GB) |
| spread_stats_hourly | 50 pairs × 24/day | ~1,200 rows | ~8,400 rows (~1 MB) |
| trading_signals | Variable | ~50-200 rows | ~350-1,400 rows (~100 KB) |

With 4 pairs (current .env):
- **Daily:** ~70,000 snapshots, ~100 stats rows
- **Weekly:** ~490,000 snapshots (~150 MB)

### Query Performance

All critical queries should complete in <100ms:

- Single pair recent snapshots (1 hour): ~5ms
- Hourly stats save: ~2ms
- Stats calculation (1 hour of data): ~50ms

If queries are slow:
1. Check indexes exist
2. Analyze table statistics: `ANALYZE TABLE spread_snapshots;`
3. Increase connection pool size in `database.ts`

## Next Steps

After collecting data for 24-72 hours:

1. **Analyze Patterns:**
   ```sql
   -- Find pairs with widest average spreads
   SELECT pair, AVG(avg_spread) as avg_spread, COUNT(*) as hours
   FROM spread_stats_hourly
   WHERE hour_timestamp > UNIX_TIMESTAMP(DATE_SUB(NOW(), INTERVAL 24 HOUR)) * 1000
   GROUP BY pair
   ORDER BY avg_spread DESC
   LIMIT 10;
   ```

2. **Identify Best Opportunities:**
   ```sql
   -- Pairs with consistent wide spreads
   SELECT
     pair,
     AVG(avg_spread) as avg_spread,
     STDDEV(avg_spread) as volatility,
     COUNT(*) as hours
   FROM spread_stats_hourly
   WHERE hour_timestamp > UNIX_TIMESTAMP(DATE_SUB(NOW(), INTERVAL 7 DAY)) * 1000
   GROUP BY pair
   HAVING COUNT(*) > 100  -- At least 100 hours of data
   ORDER BY (avg_spread / STDDEV(avg_spread)) DESC  -- Consistency ratio
   LIMIT 10;
   ```

3. **Move to Phase 3:** Signal generation and automated trading

## Resources

- [MySQL Documentation](https://dev.mysql.com/doc/)
- [Database Migrations README](./database/migrations/README.md)
- [Project README](./README.md)
