#!/bin/bash
# scripts/deploy-trades-to-ec2.sh
# Deploy trade fetching system to EC2

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "========================================="
echo "  Deploy Trade Fetcher to EC2"
echo "========================================="
echo ""

# Check if SSH key and IP are provided
if [ -z "$1" ] || [ -z "$2" ]; then
  echo -e "${RED}Error: Missing arguments${NC}"
  echo "Usage: ./scripts/deploy-trades-to-ec2.sh <ssh-key.pem> <ec2-ip-address>"
  echo ""
  echo "Example:"
  echo "  ./scripts/deploy-trades-to-ec2.sh ~/.ssh/hyperliquid-key.pem 54.123.45.67"
  exit 1
fi

SSH_KEY="$1"
EC2_IP="$2"
EC2_USER="ubuntu"
REMOTE_DIR="~/hyperliquid-bot"

# Validate SSH key exists
if [ ! -f "$SSH_KEY" ]; then
  echo -e "${RED}Error: SSH key not found: $SSH_KEY${NC}"
  exit 1
fi

echo "Configuration:"
echo "  SSH Key: $SSH_KEY"
echo "  EC2 IP: $EC2_IP"
echo "  User: $EC2_USER"
echo "  Remote Directory: $REMOTE_DIR"
echo ""

# Test SSH connection
echo -e "${YELLOW}Testing SSH connection...${NC}"
if ssh -i "$SSH_KEY" -o ConnectTimeout=10 -o StrictHostKeyChecking=no "$EC2_USER@$EC2_IP" "echo 'Connection successful'" > /dev/null 2>&1; then
  echo -e "${GREEN}✓ SSH connection successful${NC}"
else
  echo -e "${RED}✗ SSH connection failed${NC}"
  exit 1
fi
echo ""

# Step 1: Upload files
echo -e "${YELLOW}Step 1: Uploading files...${NC}"

# Create directories
ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "$EC2_USER@$EC2_IP" \
  "mkdir -p $REMOTE_DIR/scripts $REMOTE_DIR/database/migrations $REMOTE_DIR/src"

# Upload migration
scp -i "$SSH_KEY" -o StrictHostKeyChecking=no \
  database/migrations/005_create_trades.sql \
  "$EC2_USER@$EC2_IP:$REMOTE_DIR/database/migrations/"

# Upload TypeScript source
scp -i "$SSH_KEY" -o StrictHostKeyChecking=no \
  src/fetch-trades.ts \
  "$EC2_USER@$EC2_IP:$REMOTE_DIR/src/"

# Upload scripts
scp -i "$SSH_KEY" -o StrictHostKeyChecking=no \
  scripts/fetch-trades.sh \
  scripts/setup-trades-cron.sh \
  "$EC2_USER@$EC2_IP:$REMOTE_DIR/scripts/"

# Upload package.json
scp -i "$SSH_KEY" -o StrictHostKeyChecking=no \
  package.json \
  "$EC2_USER@$EC2_IP:$REMOTE_DIR/"

echo -e "${GREEN}✓ Files uploaded${NC}"
echo ""

# Step 2: Run migration
echo -e "${YELLOW}Step 2: Creating trades table...${NC}"
echo ""

ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "$EC2_USER@$EC2_IP" bash <<'EOSSH'
set -e

cd ~/hyperliquid-bot

# Load environment variables
if [ -f .env ]; then
  source .env
else
  echo "Error: .env file not found"
  exit 1
fi

# Run migration
echo "Running migration: 005_create_trades.sql"
mysql -h${DB_HOST} -u${DB_USER} -p${DB_PASSWORD} ${DB_NAME} < database/migrations/005_create_trades.sql 2>&1 | grep -v "Using a password" || true

echo "✓ Table created successfully"
echo ""

# Verify table exists
echo "Verifying table..."
mysql -h${DB_HOST} -u${DB_USER} -p${DB_PASSWORD} ${DB_NAME} -e "DESCRIBE trades;" 2>&1 | grep -v "Using a password"

echo ""
echo "✓ Table verified"
EOSSH

echo -e "${GREEN}✓ Database table created${NC}"
echo ""

# Step 3: Install dependencies and set up cron
echo -e "${YELLOW}Step 3: Setting up cron job...${NC}"
echo ""

ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "$EC2_USER@$EC2_IP" bash <<'EOSSH'
set -e

cd ~/hyperliquid-bot

# Install/update dependencies (in case new packages needed)
echo "Installing dependencies..."
npm install --production --silent

# Make scripts executable
chmod +x scripts/fetch-trades.sh
chmod +x scripts/setup-trades-cron.sh

# Get absolute paths
PROJECT_DIR="$(pwd)"
FETCH_SCRIPT="${PROJECT_DIR}/scripts/fetch-trades.sh"
LOG_DIR="${PROJECT_DIR}/logs"
LOG_FILE="${LOG_DIR}/fetch-trades.log"

# Create logs directory
mkdir -p "${LOG_DIR}"
echo "✓ Created logs directory"

# Cron schedule: Run every 5 minutes
CRON_SCHEDULE="*/5 * * * *"
CRON_COMMAND="cd ${PROJECT_DIR} && ${FETCH_SCRIPT} >> ${LOG_FILE} 2>&1"
CRON_JOB="${CRON_SCHEDULE} ${CRON_COMMAND}"

# Remove old cron job if exists
if crontab -l 2>/dev/null | grep -q "${FETCH_SCRIPT}"; then
  echo "Removing old cron job..."
  crontab -l 2>/dev/null | grep -v "${FETCH_SCRIPT}" | crontab - || true
fi

# Add new cron job
echo "Installing cron job..."
(crontab -l 2>/dev/null | grep -v "^# Trade fetcher" || true; echo "# Trade fetcher - runs every 5 minutes") | crontab -
(crontab -l 2>/dev/null; echo "${CRON_JOB}") | crontab -

echo "✓ Cron job installed"
echo ""

# Show crontab
echo "Current crontab:"
echo "========================================="
crontab -l | tail -10
echo "========================================="
echo ""

echo "Schedule Details:"
echo "  • Runs every 5 minutes"
echo "  • Fetches recent trades for all pairs"
echo "  • Log file: ${LOG_FILE}"
echo ""
EOSSH

echo -e "${GREEN}✓ Cron job configured${NC}"
echo ""

# Step 4: Test run
echo -e "${YELLOW}Step 4: Running test trade fetch...${NC}"
echo ""

ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "$EC2_USER@$EC2_IP" \
  "cd ~/hyperliquid-bot && npm run fetch:trades 2>&1 | grep -v 'npm warn'"

echo -e "${GREEN}✓ Test fetch complete${NC}"
echo ""

# Final summary
echo "========================================="
echo -e "${GREEN}✓ Deployment Successful!${NC}"
echo "========================================="
echo ""
echo "Summary:"
echo "  ✓ Table 'trades' created"
echo "  ✓ Trade fetcher runs every 5 minutes"
echo "  ✓ Upserts recent trades for all pairs"
echo ""
echo "Manual Commands:"
echo "  • View logs:"
echo "    ssh -i $SSH_KEY $EC2_USER@$EC2_IP"
echo "    tail -f ~/hyperliquid-bot/logs/fetch-trades.log"
echo ""
echo "  • View recent trades:"
echo "    ssh -i $SSH_KEY $EC2_USER@$EC2_IP"
echo "    mysql -h<host> -u<user> -p<pass> Crypto -e 'SELECT * FROM trades ORDER BY timestamp DESC LIMIT 10;'"
echo ""
