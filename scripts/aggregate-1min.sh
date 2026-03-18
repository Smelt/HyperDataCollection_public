#!/bin/bash
# scripts/aggregate-1min.sh
# Aggregate 5-second snapshots into 1-minute windows
# Runs every minute via cron

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Load environment variables
if [ -f "${SCRIPT_DIR}/.env" ]; then
  source "${SCRIPT_DIR}/.env"
elif [ -f /home/ubuntu/hyperliquid-bot/.env ]; then
  source /home/ubuntu/hyperliquid-bot/.env
else
  echo -e "${RED}Error: .env file not found${NC}" >&2
  exit 1
fi

# Check required variables
if [ -z "$DB_HOST" ] || [ -z "$DB_USER" ] || [ -z "$DB_NAME" ]; then
  echo -e "${RED}Error: Missing required DB environment variables${NC}" >&2
  exit 1
fi

# MySQL client path - auto-detect for both macOS and EC2
if [ -f "/opt/homebrew/opt/mysql-client/bin/mysql" ]; then
  MYSQL_BIN="/opt/homebrew/opt/mysql-client/bin/mysql"
elif command -v mysql &> /dev/null; then
  MYSQL_BIN="mysql"
else
  echo -e "${RED}Error: MySQL client not found${NC}" >&2
  exit 1
fi

# Database connection string
DB_CONN="-h${DB_HOST} -u${DB_USER}"

# Add password if provided
if [ -n "$DB_PASSWORD" ]; then
  DB_CONN="${DB_CONN} -p${DB_PASSWORD}"
fi

DB_CONN="${DB_CONN} ${DB_NAME}"

# Calculate time window
# Get current time in milliseconds, round down to the minute
CURRENT_MS=$(date +%s)000
CURRENT_MINUTE=$((CURRENT_MS / 60000 * 60000))

# Aggregate the previous completed minute (not the current one)
WINDOW_START=$((CURRENT_MINUTE - 60000))
WINDOW_END=$CURRENT_MINUTE

# Run aggregation query
${MYSQL_BIN} ${DB_CONN} -e "
INSERT INTO spread_snapshots_1min (
  timestamp,
  pair,
  min_price,
  max_price,
  avg_price,
  min_spread_bps,
  max_spread_bps,
  avg_spread_bps,
  avg_bid,
  avg_ask,
  avg_bid_size,
  avg_ask_size,
  avg_imbalance,
  sample_count
)
SELECT
  ${WINDOW_START} AS timestamp,
  pair,
  MIN(mid_price) AS min_price,
  MAX(mid_price) AS max_price,
  AVG(mid_price) AS avg_price,
  MIN(spread_bps) AS min_spread_bps,
  MAX(spread_bps) AS max_spread_bps,
  AVG(spread_bps) AS avg_spread_bps,
  AVG(best_bid) AS avg_bid,
  AVG(best_ask) AS avg_ask,
  AVG(bid_size) AS avg_bid_size,
  AVG(ask_size) AS avg_ask_size,
  AVG(imbalance) AS avg_imbalance,
  COUNT(*) AS sample_count
FROM spread_snapshots
WHERE timestamp >= ${WINDOW_START}
  AND timestamp < ${WINDOW_END}
  AND mid_price IS NOT NULL
GROUP BY pair
ON DUPLICATE KEY UPDATE
  min_price = VALUES(min_price),
  max_price = VALUES(max_price),
  avg_price = VALUES(avg_price),
  min_spread_bps = VALUES(min_spread_bps),
  max_spread_bps = VALUES(max_spread_bps),
  avg_spread_bps = VALUES(avg_spread_bps),
  avg_bid = VALUES(avg_bid),
  avg_ask = VALUES(avg_ask),
  avg_bid_size = VALUES(avg_bid_size),
  avg_ask_size = VALUES(avg_ask_size),
  avg_imbalance = VALUES(avg_imbalance),
  sample_count = VALUES(sample_count);
" 2>&1 | grep -v "Using a password on the command line"

# Count rows inserted/updated
ROWS_AFFECTED=$(${MYSQL_BIN} ${DB_CONN} -se "SELECT ROW_COUNT();" 2>&1 | grep -v "Using a password")

# Log timestamp for this aggregation
WINDOW_TIME=$(date -d "@$((WINDOW_START / 1000))" "+%Y-%m-%d %H:%M:%S" 2>/dev/null || date -r $((WINDOW_START / 1000)) "+%Y-%m-%d %H:%M:%S" 2>/dev/null || echo "1-min ago")

echo "$(date '+%Y-%m-%d %H:%M:%S') - Aggregated ${ROWS_AFFECTED} pairs for window: ${WINDOW_TIME}"

exit 0
