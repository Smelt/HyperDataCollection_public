#!/bin/bash
# scripts/migrate.sh
# Run all pending database migrations

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "========================================="
echo "  Database Migration Runner"
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
  echo "Required: DB_HOST, DB_USER, DB_NAME, DB_PASSWORD"
  exit 1
fi

# MySQL client path
MYSQL_BIN="/opt/homebrew/opt/mysql-client/bin/mysql"

# Database connection string
DB_CONN="-h${DB_HOST} -u${DB_USER}"

# Add password if provided
if [ -n "$DB_PASSWORD" ]; then
  DB_CONN="${DB_CONN} -p${DB_PASSWORD}"
fi

DB_CONN="${DB_CONN} ${DB_NAME}"

# Check if database exists
if ! ${MYSQL_BIN} ${DB_CONN} -e "SELECT 1" &>/dev/null; then
  echo -e "${RED}Error: Cannot connect to database${NC}"
  echo "Please check your database credentials and ensure the database exists."
  echo "Run './scripts/setup-db.sh' to create the database."
  exit 1
fi

# Get current migration version
CURRENT_VERSION=$(${MYSQL_BIN} ${DB_CONN} \
  -se "SELECT COALESCE(MAX(version), 0) FROM schema_migrations;" 2>/dev/null || echo "0")

echo -e "Current schema version: ${GREEN}${CURRENT_VERSION}${NC}"
echo ""

# Find all migration files
MIGRATION_COUNT=0
for migration in database/migrations/*.sql; do
  # Skip if no migrations exist
  if [ ! -f "$migration" ]; then
    continue
  fi

  # Extract version number from filename
  FILENAME=$(basename "$migration")
  VERSION=$(echo "$FILENAME" | cut -d'_' -f1)

  # Skip if not a valid number
  if ! [[ "$VERSION" =~ ^[0-9]+$ ]]; then
    echo -e "${YELLOW}Warning: Skipping invalid migration file: ${FILENAME}${NC}"
    continue
  fi

  # Apply if version is newer than current
  if [ "$VERSION" -gt "$CURRENT_VERSION" ]; then
    echo -e "${YELLOW}Applying migration ${VERSION}: ${FILENAME}${NC}"

    # Run migration
    if ${MYSQL_BIN} ${DB_CONN} < "$migration"; then
      echo -e "${GREEN}✓ Migration ${VERSION} applied successfully${NC}"
      MIGRATION_COUNT=$((MIGRATION_COUNT + 1))
    else
      echo -e "${RED}✗ Migration ${VERSION} failed${NC}"
      exit 1
    fi
    echo ""
  fi
done

if [ "$MIGRATION_COUNT" -eq 0 ]; then
  echo -e "${GREEN}No new migrations to apply. Database is up to date.${NC}"
else
  echo -e "${GREEN}Successfully applied ${MIGRATION_COUNT} migration(s)${NC}"
fi

echo ""
echo "========================================="
