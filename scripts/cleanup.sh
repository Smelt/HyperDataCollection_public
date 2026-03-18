#!/bin/bash
# scripts/cleanup.sh
# Remove old data based on retention policies

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "========================================="
echo "  Database Cleanup"
echo "========================================="

# Load environment variables
if [ ! -f .env ]; then
  echo -e "${RED}Error: .env file not found${NC}"
  exit 1
fi

source .env

# Check required variables
if [ -z "$DB_HOST" ] || [ -z "$DB_USER" ] || [ -z "$DB_NAME" ]; then
  echo -e "${RED}Error: Missing required DB environment variables${NC}"
  exit 1
fi

# MySQL client path - auto-detect for both macOS and EC2
if [ -f "/opt/homebrew/opt/mysql-client/bin/mysql" ]; then
  MYSQL_BIN="/opt/homebrew/opt/mysql-client/bin/mysql"
elif command -v mysql &> /dev/null; then
  MYSQL_BIN="mysql"
else
  echo -e "${RED}Error: MySQL client not found${NC}"
  exit 1
fi

# Database connection string
DB_CONN="-h${DB_HOST} -u${DB_USER}"

# Add password if provided
if [ -n "$DB_PASSWORD" ]; then
  DB_CONN="${DB_CONN} -p${DB_PASSWORD}"
fi

DB_CONN="${DB_CONN} ${DB_NAME}"

# Test connection
if ! ${MYSQL_BIN} ${DB_CONN} -e "SELECT 1" &>/dev/null; then
  echo -e "${RED}Error: Cannot connect to database${NC}"
  exit 1
fi

echo "Connected to database: $DB_NAME"
echo ""

# 1. Delete old snapshots (older than 31 days)
SNAPSHOT_CUTOFF=$(($(date +%s) * 1000 - 31 * 24 * 60 * 60 * 1000))
echo "Deleting snapshots older than 31 days..."

DELETED=$(${MYSQL_BIN} ${DB_CONN} -se \
  "DELETE FROM spread_snapshots WHERE timestamp < ${SNAPSHOT_CUTOFF};
   SELECT ROW_COUNT();")

echo -e "${GREEN}✓ Deleted ${DELETED} old snapshots${NC}"
echo ""

# 2. Delete old 1-minute aggregates (older than 1 year)
AGGREGATE_1MIN_CUTOFF=$(($(date +%s) * 1000 - 365 * 24 * 60 * 60 * 1000))
echo "Deleting 1-minute aggregates older than 1 year..."

# Check if table exists first
TABLE_EXISTS=$(${MYSQL_BIN} ${DB_CONN} -se \
  "SELECT COUNT(*) FROM information_schema.TABLES WHERE table_schema = '${DB_NAME}' AND table_name = 'spread_snapshots_1min';" 2>&1 | grep -v "Using a password")

if [ "$TABLE_EXISTS" -eq "1" ]; then
  DELETED=$(${MYSQL_BIN} ${DB_CONN} -se \
    "DELETE FROM spread_snapshots_1min WHERE timestamp < ${AGGREGATE_1MIN_CUTOFF};
     SELECT ROW_COUNT();")
  echo -e "${GREEN}✓ Deleted ${DELETED} old 1-minute aggregates${NC}"
else
  echo -e "${YELLOW}⚠ Table spread_snapshots_1min does not exist yet${NC}"
fi
echo ""

# 3. Delete old signals (older than 30 days)
SIGNAL_CUTOFF=$(($(date +%s) * 1000 - 30 * 24 * 60 * 60 * 1000))
echo "Deleting signals older than 30 days..."

DELETED=$(${MYSQL_BIN} ${DB_CONN} -se \
  "DELETE FROM trading_signals WHERE timestamp < ${SIGNAL_CUTOFF};
   SELECT ROW_COUNT();")

echo -e "${GREEN}✓ Deleted ${DELETED} old signals${NC}"
echo ""

# 4. Optimize tables
echo "Optimizing tables..."
${MYSQL_BIN} ${DB_CONN} -e "OPTIMIZE TABLE spread_snapshots;"
if [ "$TABLE_EXISTS" -eq "1" ]; then
  ${MYSQL_BIN} ${DB_CONN} -e "OPTIMIZE TABLE spread_snapshots_1min;"
fi
${MYSQL_BIN} ${DB_CONN} -e "OPTIMIZE TABLE trading_signals;"

echo -e "${GREEN}✓ Tables optimized${NC}"
echo ""

# 5. Show database size
echo "Database Statistics:"
${MYSQL_BIN} ${DB_CONN} -e "
  SELECT
    table_name,
    ROUND(((data_length + index_length) / 1024 / 1024), 2) AS size_mb,
    table_rows
  FROM information_schema.TABLES
  WHERE table_schema = '$DB_NAME'
  ORDER BY (data_length + index_length) DESC;
"

echo ""
echo "========================================="
echo -e "${GREEN}✓ Cleanup complete!${NC}"
echo "========================================="
