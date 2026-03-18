#!/bin/bash
# scripts/backfill-1min-aggregates.sh
# Backfill 1-minute aggregates from historical 5-second snapshots

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
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

# MySQL client path
if [ -f "/opt/homebrew/opt/mysql-client/bin/mysql" ]; then
  MYSQL_BIN="/opt/homebrew/opt/mysql-client/bin/mysql"
elif command -v mysql &> /dev/null; then
  MYSQL_BIN="mysql"
else
  echo -e "${RED}Error: MySQL client not found${NC}" >&2
  exit 1
fi

# Database connection
DB_CONN="-h${DB_HOST} -u${DB_USER}"
if [ -n "$DB_PASSWORD" ]; then
  DB_CONN="${DB_CONN} -p${DB_PASSWORD}"
fi
DB_CONN="${DB_CONN} ${DB_NAME}"

echo "========================================="
echo "  Backfill 1-Minute Aggregates"
echo "========================================="
echo ""

# Get command line argument for number of days (default: 7)
DAYS_BACK=${1:-7}

echo "Configuration:"
echo "  Days to backfill: ${DAYS_BACK}"
echo "  Database: ${DB_NAME}"
echo ""

# Get the earliest available data timestamp
EARLIEST_DATA=$(${MYSQL_BIN} ${DB_CONN} -se "SELECT MIN(timestamp) FROM spread_snapshots;" 2>&1 | grep -v "Using a password")

if [ -z "$EARLIEST_DATA" ] || [ "$EARLIEST_DATA" = "NULL" ]; then
  echo -e "${RED}Error: No data found in spread_snapshots table${NC}"
  exit 1
fi

EARLIEST_TIME=$(date -d "@$((EARLIEST_DATA / 1000))" "+%Y-%m-%d %H:%M:%S" 2>/dev/null || date -r $((EARLIEST_DATA / 1000)) "+%Y-%m-%d %H:%M:%S" 2>/dev/null)
echo "Earliest available data: ${EARLIEST_TIME}"

# Calculate time range
CURRENT_TIME_MS=$(date +%s)000
START_TIME_MS=$((CURRENT_TIME_MS - (DAYS_BACK * 24 * 60 * 60 * 1000)))

# Use earliest available data if requested range goes beyond it
if [ "$START_TIME_MS" -lt "$EARLIEST_DATA" ]; then
  START_TIME_MS=$EARLIEST_DATA
  ACTUAL_DAYS=$(( (CURRENT_TIME_MS - START_TIME_MS) / (24 * 60 * 60 * 1000) ))
  echo -e "${YELLOW}⚠ Adjusting to available data: ${ACTUAL_DAYS} days${NC}"
fi

# Round to minute boundaries
START_TIME_MS=$((START_TIME_MS / 60000 * 60000))
END_TIME_MS=$((CURRENT_TIME_MS / 60000 * 60000))

START_TIME_STR=$(date -d "@$((START_TIME_MS / 1000))" "+%Y-%m-%d %H:%M:%S" 2>/dev/null || date -r $((START_TIME_MS / 1000)) "+%Y-%m-%d %H:%M:%S" 2>/dev/null)
END_TIME_STR=$(date -d "@$((END_TIME_MS / 1000))" "+%Y-%m-%d %H:%M:%S" 2>/dev/null || date -r $((END_TIME_MS / 1000)) "+%Y-%m-%d %H:%M:%S" 2>/dev/null)

TOTAL_MINUTES=$(( (END_TIME_MS - START_TIME_MS) / 60000 ))

echo ""
echo "Backfill Range:"
echo "  Start: ${START_TIME_STR}"
echo "  End:   ${END_TIME_STR}"
echo "  Total Minutes: ${TOTAL_MINUTES}"
echo ""

# Confirm before proceeding
echo -e "${YELLOW}This will process ${TOTAL_MINUTES} minutes of data.${NC}"
echo "Continue? (y/n)"
read -r CONFIRM

if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
  echo "Cancelled."
  exit 0
fi

echo ""
echo "Starting backfill..."
echo ""

# Progress tracking
PROCESSED=0
ERRORS=0
PROGRESS_UPDATE=60  # Update every 60 minutes

# Create temp file for SQL
TEMP_SQL=$(mktemp)

# Loop through each minute
CURRENT_WINDOW=$START_TIME_MS
while [ $CURRENT_WINDOW -lt $END_TIME_MS ]; do
  NEXT_WINDOW=$((CURRENT_WINDOW + 60000))

  # Generate SQL for this minute
  cat > "$TEMP_SQL" <<EOF
INSERT INTO spread_snapshots_1min (
  timestamp, pair, min_price, max_price, avg_price,
  min_spread_bps, max_spread_bps, avg_spread_bps,
  avg_bid, avg_ask, avg_bid_size, avg_ask_size, avg_imbalance, sample_count
)
SELECT
  ${CURRENT_WINDOW} AS timestamp,
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
WHERE timestamp >= ${CURRENT_WINDOW}
  AND timestamp < ${NEXT_WINDOW}
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
EOF

  # Execute SQL
  if ${MYSQL_BIN} ${DB_CONN} < "$TEMP_SQL" 2>&1 | grep -v "Using a password" > /dev/null; then
    PROCESSED=$((PROCESSED + 1))
  else
    ERRORS=$((ERRORS + 1))
  fi

  # Progress update
  if [ $((PROCESSED % PROGRESS_UPDATE)) -eq 0 ]; then
    PERCENT=$((PROCESSED * 100 / TOTAL_MINUTES))
    TIME_STR=$(date -d "@$((CURRENT_WINDOW / 1000))" "+%Y-%m-%d %H:%M" 2>/dev/null || date -r $((CURRENT_WINDOW / 1000)) "+%Y-%m-%d %H:%M" 2>/dev/null)
    echo -e "${BLUE}Progress: ${PROCESSED}/${TOTAL_MINUTES} minutes (${PERCENT}%) - ${TIME_STR}${NC}"
  fi

  CURRENT_WINDOW=$NEXT_WINDOW
done

# Cleanup
rm -f "$TEMP_SQL"

# Final summary
echo ""
echo "========================================="
echo -e "${GREEN}✓ Backfill Complete!${NC}"
echo "========================================="
echo ""
echo "Summary:"
echo "  Processed: ${PROCESSED} minutes"
echo "  Errors: ${ERRORS}"
echo "  Time Range: ${START_TIME_STR} to ${END_TIME_STR}"
echo ""

# Show statistics
echo "Database Statistics:"
${MYSQL_BIN} ${DB_CONN} -e "
SELECT
  COUNT(*) as total_aggregates,
  COUNT(DISTINCT pair) as unique_pairs,
  MIN(FROM_UNIXTIME(timestamp/1000)) as earliest,
  MAX(FROM_UNIXTIME(timestamp/1000)) as latest,
  SUM(sample_count) as total_snapshots_aggregated
FROM spread_snapshots_1min;
" 2>&1 | grep -v "Using a password"

echo ""
echo "Top 5 Pairs by Sample Count:"
${MYSQL_BIN} ${DB_CONN} -e "
SELECT
  pair,
  COUNT(*) as minutes,
  SUM(sample_count) as total_samples,
  AVG(avg_spread_bps) as avg_spread
FROM spread_snapshots_1min
GROUP BY pair
ORDER BY total_samples DESC
LIMIT 5;
" 2>&1 | grep -v "Using a password"

echo ""
