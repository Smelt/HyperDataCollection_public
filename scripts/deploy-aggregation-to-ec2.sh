#!/bin/bash
# scripts/deploy-aggregation-to-ec2.sh
# Deploy 1-minute aggregation system to EC2

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "========================================="
echo "  Deploy 1-Minute Aggregation to EC2"
echo "========================================="
echo ""

# Check if SSH key and IP are provided
if [ -z "$1" ] || [ -z "$2" ]; then
  echo -e "${RED}Error: Missing arguments${NC}"
  echo "Usage: ./scripts/deploy-aggregation-to-ec2.sh <ssh-key.pem> <ec2-ip-address>"
  echo ""
  echo "Example:"
  echo "  ./scripts/deploy-aggregation-to-ec2.sh ~/.ssh/hyperliquid-key.pem 54.123.45.67"
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

# Step 1: Upload migration and scripts
echo -e "${YELLOW}Step 1: Uploading files...${NC}"

# Create remote directories
ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "$EC2_USER@$EC2_IP" \
  "mkdir -p $REMOTE_DIR/scripts $REMOTE_DIR/database/migrations"

# Upload migration
scp -i "$SSH_KEY" -o StrictHostKeyChecking=no \
  database/migrations/004_create_spread_snapshots_1min.sql \
  "$EC2_USER@$EC2_IP:$REMOTE_DIR/database/migrations/"

# Upload scripts
scp -i "$SSH_KEY" -o StrictHostKeyChecking=no \
  scripts/aggregate-1min.sh \
  scripts/setup-aggregate-cron.sh \
  scripts/cleanup.sh \
  "$EC2_USER@$EC2_IP:$REMOTE_DIR/scripts/"

echo -e "${GREEN}✓ Files uploaded${NC}"
echo ""

# Step 2: Run migration to create table
echo -e "${YELLOW}Step 2: Creating database table...${NC}"
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
echo "Running migration: 004_create_spread_snapshots_1min.sql"
mysql -h${DB_HOST} -u${DB_USER} -p${DB_PASSWORD} ${DB_NAME} < database/migrations/004_create_spread_snapshots_1min.sql 2>&1 | grep -v "Using a password" || true

echo "✓ Table created successfully"
echo ""

# Verify table exists
echo "Verifying table..."
mysql -h${DB_HOST} -u${DB_USER} -p${DB_PASSWORD} ${DB_NAME} -e "DESCRIBE spread_snapshots_1min;" 2>&1 | grep -v "Using a password"

echo ""
echo "✓ Table verified"
EOSSH

echo -e "${GREEN}✓ Database table created${NC}"
echo ""

# Step 3: Set up cron job
echo -e "${YELLOW}Step 3: Setting up cron job...${NC}"
echo ""

ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "$EC2_USER@$EC2_IP" bash <<'EOSSH'
set -e

cd ~/hyperliquid-bot

# Make scripts executable
chmod +x scripts/aggregate-1min.sh
chmod +x scripts/setup-aggregate-cron.sh
chmod +x scripts/cleanup.sh

# Get absolute paths
PROJECT_DIR="$(pwd)"
AGGREGATE_SCRIPT="${PROJECT_DIR}/scripts/aggregate-1min.sh"
LOG_DIR="${PROJECT_DIR}/logs"
LOG_FILE="${LOG_DIR}/aggregate-1min.log"

# Create logs directory
mkdir -p "${LOG_DIR}"
echo "✓ Created logs directory"

# Cron schedule: Run every minute
CRON_SCHEDULE="* * * * *"
CRON_COMMAND="cd ${PROJECT_DIR} && ${AGGREGATE_SCRIPT} >> ${LOG_FILE} 2>&1"
CRON_JOB="${CRON_SCHEDULE} ${CRON_COMMAND}"

# Remove old cron job if exists
if crontab -l 2>/dev/null | grep -q "${AGGREGATE_SCRIPT}"; then
  echo "Removing old cron job..."
  crontab -l 2>/dev/null | grep -v "${AGGREGATE_SCRIPT}" | crontab - || true
fi

# Add new cron job
echo "Installing cron job..."
(crontab -l 2>/dev/null | grep -v "^# 1-minute data aggregation" || true; echo "# 1-minute data aggregation - runs every minute") | crontab -
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
echo "  • Runs every minute"
echo "  • Aggregates 5-second snapshots into 1-minute windows"
echo "  • Log file: ${LOG_FILE}"
echo ""
EOSSH

echo -e "${GREEN}✓ Cron job configured${NC}"
echo ""

# Step 4: Test run
echo -e "${YELLOW}Step 4: Running test aggregation...${NC}"
echo ""

ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "$EC2_USER@$EC2_IP" \
  "cd ~/hyperliquid-bot && ./scripts/aggregate-1min.sh"

echo -e "${GREEN}✓ Test aggregation complete${NC}"
echo ""

# Final summary
echo "========================================="
echo -e "${GREEN}✓ Deployment Successful!${NC}"
echo "========================================="
echo ""
echo "Summary:"
echo "  ✓ Table 'spread_snapshots_1min' created"
echo "  ✓ Aggregation runs every minute"
echo "  ✓ Cleanup updated (keeps 1min data for 1 year)"
echo ""
echo "Data Retention Policy:"
echo "  • 5-second snapshots: 31 days"
echo "  • 1-minute aggregates: 1 year"
echo "  • Hourly stats: Forever"
echo ""
echo "Manual Commands:"
echo "  • View aggregation logs:"
echo "    ssh -i $SSH_KEY $EC2_USER@$EC2_IP"
echo "    tail -f ~/hyperliquid-bot/logs/aggregate-1min.log"
echo ""
echo "  • View recent aggregates:"
echo "    ssh -i $SSH_KEY $EC2_USER@$EC2_IP"
echo "    mysql -h<host> -u<user> -p<pass> Crypto -e 'SELECT * FROM spread_snapshots_1min ORDER BY timestamp DESC LIMIT 10;'"
echo ""
