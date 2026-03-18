# Database Migrations

This directory contains all database schema migrations for the Hyperliquid Market Making Bot.

## Migration Files

Migrations are numbered SQL files that apply schema changes in order:

```
001_initial_schema.sql       - Initial database tables
002_add_new_feature.sql      - Example future migration
003_optimize_indexes.sql     - Example future migration
```

## Naming Convention

```
[number]_[description].sql

Examples:
001_initial_schema.sql
002_add_volume_columns.sql
003_add_user_tables.sql
```

## Running Migrations

### First Time Setup

```bash
# 1. Copy .env.example to .env and configure database credentials
cp .env.example .env

# 2. Edit .env with your MySQL credentials
# 3. Run the setup script
./scripts/setup-db.sh
```

This will:
- Create the database if it doesn't exist
- Run all pending migrations
- Verify the database is ready

### Applying New Migrations

```bash
./scripts/migrate.sh
```

This script:
- Checks which migrations have been applied
- Applies any new migrations in order
- Tracks migration status in `schema_migrations` table

## Creating a New Migration

1. Create a new file with the next sequential number:
   ```bash
   touch database/migrations/002_add_new_feature.sql
   ```

2. Use this template:

```sql
-- Migration: [Short Description]
-- Version: [Number]
-- Created: [Date]
-- Description: [Detailed explanation of changes]
--
-- Rollback Instructions:
-- [How to undo this migration manually if needed]

-- Migration Code
CREATE TABLE example (
  id INT AUTO_INCREMENT PRIMARY KEY,
  -- columns here
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Track migration
INSERT INTO schema_migrations (version, name)
VALUES ([number], '[description]');
```

3. Run the migration:
   ```bash
   ./scripts/migrate.sh
   ```

## Current Schema

The current schema includes:

### Tables

1. **schema_migrations** - Tracks applied migrations
2. **spread_snapshots** - Raw spread data (5-second intervals)
3. **spread_stats_hourly** - Aggregated hourly statistics
4. **trading_signals** - Generated trading signals

### Retention Policies

- **spread_snapshots**: 7 days (cleaned up daily)
- **spread_stats_hourly**: Forever (permanent baseline)
- **trading_signals**: 30 days (cleaned up daily)

## Maintenance

### Cleanup Old Data

```bash
./scripts/cleanup.sh
```

Removes data older than retention policies and optimizes tables.

### Backup Database

```bash
./scripts/backup.sh
```

Creates compressed backup with 7-day rotation.

### Schedule Automatic Maintenance

Add to crontab:

```bash
# Daily cleanup at 2 AM
0 2 * * * cd /path/to/project && ./scripts/cleanup.sh >> /var/log/hyperliquid-cleanup.log 2>&1

# Daily backup at 3 AM
0 3 * * * cd /path/to/project && ./scripts/backup.sh >> /var/log/hyperliquid-backup.log 2>&1
```

## Troubleshooting

### Migration Failed

If a migration fails:

1. Check the error message
2. Fix the SQL in the migration file
3. Manually rollback if needed (see rollback instructions in the migration)
4. Run `./scripts/migrate.sh` again

### Database Connection Issues

```bash
# Test connection
mysql -h$DB_HOST -u$DB_USER -p$DB_PASSWORD $DB_NAME -e "SELECT 1"
```

### Check Migration Status

```bash
mysql -h$DB_HOST -u$DB_USER -p$DB_PASSWORD $DB_NAME -e "SELECT * FROM schema_migrations ORDER BY version"
```

## Best Practices

1. **Never modify existing migrations** - Create a new migration instead
2. **Test migrations locally first** - Before applying to production
3. **Include rollback instructions** - Document how to undo changes
4. **Keep migrations atomic** - Each migration should do one thing
5. **Backup before migrating** - Always backup production database first

## Schema Diagram

```
spread_snapshots (7 days retention)
├── id (BIGINT, PK)
├── timestamp (BIGINT)
├── pair (VARCHAR)
├── best_bid (DECIMAL)
├── best_ask (DECIMAL)
├── spread_pct (DECIMAL)
├── spread_bps (DECIMAL)
├── bid_size (DECIMAL)
├── ask_size (DECIMAL)
├── mid_price (DECIMAL)
└── imbalance (DECIMAL)

spread_stats_hourly (permanent)
├── id (INT, PK)
├── hour_timestamp (BIGINT)
├── pair (VARCHAR)
├── avg_spread (DECIMAL)
├── min_spread (DECIMAL)
├── max_spread (DECIMAL)
├── std_dev (DECIMAL)
├── median_spread (DECIMAL)
├── sample_count (INT)
└── avg_volume (DECIMAL)

trading_signals (30 days retention)
├── id (INT, PK)
├── timestamp (BIGINT)
├── pair (VARCHAR)
├── signal_type (ENUM)
├── current_spread (DECIMAL)
├── avg_spread_1h (DECIMAL)
├── avg_spread_24h (DECIMAL)
├── threshold (DECIMAL)
├── confidence (DECIMAL)
├── expected_profit (DECIMAL)
└── reasoning (TEXT)
```
