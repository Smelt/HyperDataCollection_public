#!/bin/bash
# scripts/setup-db.sh
# Initial database setup - run once

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "========================================="
echo "  Initial Database Setup"
echo "========================================="

# Load environment variables
if [ ! -f .env ]; then
  echo -e "${RED}Error: .env file not found${NC}"
  echo "Please create a .env file based on .env.example"
  exit 1
fi

source .env

# Check required variables
if [ -z "$DB_HOST" ] || [ -z "$DB_USER" ] || [ -z "$DB_NAME" ]; then
  echo -e "${RED}Error: Missing required DB environment variables${NC}"
  echo "Required: DB_HOST, DB_USER, DB_NAME, DB_PASSWORD"
  exit 1
fi

echo "Database Configuration:"
echo "  Host: $DB_HOST"
echo "  Port: ${DB_PORT:-3306}"
echo "  User: $DB_USER"
echo "  Database: $DB_NAME"
echo ""

# MySQL client paths
MYSQL_BIN="/opt/homebrew/opt/mysql-client/bin/mysql"

# Create database connection string (without database name)
DB_CONN="-h${DB_HOST} -u${DB_USER}"

# Add password if provided
if [ -n "$DB_PASSWORD" ]; then
  DB_CONN="${DB_CONN} -p${DB_PASSWORD}"
fi

# Test connection
echo "Testing database connection..."
if ! ${MYSQL_BIN} ${DB_CONN} -e "SELECT 1" &>/dev/null; then
  echo -e "${RED}Error: Cannot connect to MySQL server${NC}"
  echo "Please check your database credentials in .env file"
  exit 1
fi
echo -e "${GREEN}✓ Connected to MySQL server${NC}"
echo ""

# Create database if it doesn't exist
echo "Creating database: $DB_NAME"
${MYSQL_BIN} ${DB_CONN} \
  -e "CREATE DATABASE IF NOT EXISTS $DB_NAME CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

echo -e "${GREEN}✓ Database created${NC}"
echo ""

# Make migrate script executable
chmod +x ./scripts/migrate.sh

# Run migrations
echo "Running migrations..."
./scripts/migrate.sh

echo ""
echo "========================================="
echo -e "${GREEN}✓ Database setup complete!${NC}"
echo "========================================="
echo ""
echo "Next steps:"
echo "  1. Update your .env file with correct database credentials"
echo "  2. Install dependencies: npm install"
echo "  3. Start the application: npm start"
echo ""
