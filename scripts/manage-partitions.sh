#!/bin/bash
# Partition Management Script
# Purpose: Maintain rolling 7-day partitions for trade_sizes table
# Run daily via cron: 0 1 * * * /path/to/manage-partitions.sh
#
# What it does:
# 1. Creates partitions for the next 3 days (if not exist)
# 2. Drops partitions older than 7 days
# 3. Updates partition_management tracking table

set -e

# Load environment variables
if [ -f ~/.env ]; then
  source ~/.env
elif [ -f .env ]; then
  source .env
fi

# Database connection
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-3306}"
DB_USER="${DB_USER:-root}"
DB_PASSWORD="${DB_PASSWORD:-}"
DB_NAME="${DB_NAME:-Crypto}"

MYSQL_CMD="mysql -h$DB_HOST -P$DB_PORT -u$DB_USER -p$DB_PASSWORD $DB_NAME"

echo "=========================================="
echo "Partition Management - $(date)"
echo "=========================================="

# Get current date components
TODAY=$(date +%Y%m%d)
TODAY_EPOCH_MS=$(date -d "$(date +%Y-%m-%d)" +%s)000

echo "Today: $TODAY"

# Function to create partition for a specific date
create_partition() {
  local DATE_STR=$1  # Format: YYYYMMDD
  local PARTITION_NAME="p${DATE_STR}"

  # Calculate the LESS THAN value (start of next day in ms)
  local YEAR=${DATE_STR:0:4}
  local MONTH=${DATE_STR:4:2}
  local DAY=${DATE_STR:6:2}

  # Get next day's epoch in milliseconds
  local NEXT_DAY=$(date -d "${YEAR}-${MONTH}-${DAY} +1 day" +%s)000

  echo "Creating partition $PARTITION_NAME (< $NEXT_DAY)..."

  # Check if partition exists
  EXISTS=$($MYSQL_CMD -N -e "
    SELECT COUNT(*) FROM information_schema.PARTITIONS
    WHERE TABLE_SCHEMA = '$DB_NAME'
    AND TABLE_NAME = 'trade_sizes'
    AND PARTITION_NAME = '$PARTITION_NAME'
  " 2>/dev/null || echo "0")

  if [ "$EXISTS" -eq "0" ]; then
    # Reorganize p_future partition to add new partition before it
    $MYSQL_CMD -e "
      ALTER TABLE trade_sizes REORGANIZE PARTITION p_future INTO (
        PARTITION $PARTITION_NAME VALUES LESS THAN ($NEXT_DAY),
        PARTITION p_future VALUES LESS THAN MAXVALUE
      );
    " 2>/dev/null && echo "  Created $PARTITION_NAME" || echo "  Failed to create $PARTITION_NAME"
  else
    echo "  Partition $PARTITION_NAME already exists"
  fi
}

# Function to drop partition for a specific date
drop_partition() {
  local DATE_STR=$1  # Format: YYYYMMDD
  local PARTITION_NAME="p${DATE_STR}"

  echo "Dropping partition $PARTITION_NAME..."

  # Check if partition exists
  EXISTS=$($MYSQL_CMD -N -e "
    SELECT COUNT(*) FROM information_schema.PARTITIONS
    WHERE TABLE_SCHEMA = '$DB_NAME'
    AND TABLE_NAME = 'trade_sizes'
    AND PARTITION_NAME = '$PARTITION_NAME'
  " 2>/dev/null || echo "0")

  if [ "$EXISTS" -gt "0" ]; then
    $MYSQL_CMD -e "ALTER TABLE trade_sizes DROP PARTITION $PARTITION_NAME;" 2>/dev/null \
      && echo "  Dropped $PARTITION_NAME" \
      || echo "  Failed to drop $PARTITION_NAME"
  else
    echo "  Partition $PARTITION_NAME does not exist"
  fi
}

# Create partitions for next 3 days
echo ""
echo "Creating future partitions..."
for i in 1 2 3; do
  FUTURE_DATE=$(date -d "+${i} days" +%Y%m%d)
  create_partition $FUTURE_DATE
done

# Drop partitions older than 7 days
echo ""
echo "Dropping old partitions (>7 days)..."
for i in 8 9 10 11 12 13 14; do
  OLD_DATE=$(date -d "-${i} days" +%Y%m%d)
  drop_partition $OLD_DATE
done

# Update tracking table
echo ""
echo "Updating partition_management table..."
$MYSQL_CMD -e "
  UPDATE partition_management
  SET last_partition_created = CURDATE(),
      last_partition_dropped = DATE_SUB(CURDATE(), INTERVAL 8 DAY)
  WHERE table_name = 'trade_sizes';
" 2>/dev/null

# Show current partitions
echo ""
echo "Current partitions:"
$MYSQL_CMD -e "
  SELECT
    PARTITION_NAME,
    PARTITION_DESCRIPTION as less_than_ms,
    TABLE_ROWS as rows
  FROM information_schema.PARTITIONS
  WHERE TABLE_SCHEMA = '$DB_NAME'
  AND TABLE_NAME = 'trade_sizes'
  ORDER BY PARTITION_ORDINAL_POSITION;
" 2>/dev/null

echo ""
echo "Partition management complete!"
