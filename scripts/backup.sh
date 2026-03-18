#!/bin/bash
# scripts/backup.sh
# Backup database with compression and rotation

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "========================================="
echo "  Database Backup"
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

# Set backup directory
BACKUP_DIR="${BACKUP_DIR:-./backups}"
mkdir -p "$BACKUP_DIR"

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/hyperliquid_${TIMESTAMP}.sql"

echo "Database: $DB_NAME"
echo "Backup file: ${BACKUP_FILE}.gz"
echo ""

# MySQL client paths
MYSQL_BIN="/opt/homebrew/opt/mysql-client/bin/mysql"
MYSQLDUMP_BIN="/opt/homebrew/opt/mysql-client/bin/mysqldump"

# Test connection
DB_CONN="-h${DB_HOST} -u${DB_USER}"
if [ -n "$DB_PASSWORD" ]; then
  DB_CONN="${DB_CONN} -p${DB_PASSWORD}"
fi

if ! ${MYSQL_BIN} ${DB_CONN} ${DB_NAME} -e "SELECT 1" &>/dev/null; then
  echo -e "${RED}Error: Cannot connect to database${NC}"
  exit 1
fi

echo "Creating backup..."

# Dump database
${MYSQLDUMP_BIN} -h"$DB_HOST" -u"$DB_USER" ${DB_PASSWORD:+-p"$DB_PASSWORD"} \
  --single-transaction \
  --routines \
  --triggers \
  "$DB_NAME" > "$BACKUP_FILE"

# Compress
gzip "$BACKUP_FILE"

BACKUP_SIZE=$(du -h "${BACKUP_FILE}.gz" | cut -f1)

echo -e "${GREEN}✓ Backup created: ${BACKUP_FILE}.gz (${BACKUP_SIZE})${NC}"
echo ""

# Keep only last 7 days of backups
echo "Cleaning up old backups (keeping last 7 days)..."
DELETED_COUNT=$(find "$BACKUP_DIR" -name "hyperliquid_*.sql.gz" -mtime +7 -delete -print | wc -l)

echo -e "${GREEN}✓ Removed ${DELETED_COUNT} old backups${NC}"
echo ""

# List remaining backups
echo "Available backups:"
ls -lh "$BACKUP_DIR"/hyperliquid_*.sql.gz 2>/dev/null || echo "  No backups found"

echo ""
echo "========================================="
echo -e "${GREEN}✓ Backup complete!${NC}"
echo "========================================="
