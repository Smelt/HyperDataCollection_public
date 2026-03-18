#!/bin/bash
# scripts/deploy-rate-limit-monitor.sh
# Deploy rate limit monitor to EC2 with PM2

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "========================================="
echo "  Deploy Rate Limit Monitor to EC2"
echo "========================================="
echo ""

# Check if SSH key and IP are provided
if [ -z "$1" ] || [ -z "$2" ]; then
  echo -e "${RED}Error: Missing arguments${NC}"
  echo "Usage: ./scripts/deploy-rate-limit-monitor.sh <ssh-key.pem> <ec2-ip-address>"
  echo ""
  echo "Example:"
  echo "  ./scripts/deploy-rate-limit-monitor.sh ~/.ssh/hyperliquid-key.pem 54.123.45.67"
  exit 1
fi

SSH_KEY="$1"
EC2_IP="$2"
EC2_USER="ubuntu"
REMOTE_DIR="~/hyperliquid-bot"
PM2_APP_NAME="rate-limit-monitor"

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
echo "  PM2 App Name: $PM2_APP_NAME"
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
  "mkdir -p $REMOTE_DIR/src/monitors"

# Upload monitor script
scp -i "$SSH_KEY" -o StrictHostKeyChecking=no \
  src/monitors/rate-limit-monitor.ts \
  "$EC2_USER@$EC2_IP:$REMOTE_DIR/src/monitors/"

# Upload package.json
scp -i "$SSH_KEY" -o StrictHostKeyChecking=no \
  package.json \
  "$EC2_USER@$EC2_IP:$REMOTE_DIR/"

echo -e "${GREEN}✓ Files uploaded${NC}"
echo ""

# Step 2: Create table and set up PM2
echo -e "${YELLOW}Step 2: Setting up database and PM2...${NC}"
echo ""

ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "$EC2_USER@$EC2_IP" bash <<EOSSH
set -e

cd ~/hyperliquid-bot

# Load environment variables
if [ -f .env ]; then
  source .env
else
  echo "Error: .env file not found"
  exit 1
fi

# Install/update dependencies (including tsx for TypeScript execution)
echo "Installing dependencies..."
npm install --silent 2>/dev/null || npm install
npm install tsx --save-dev --silent 2>/dev/null || npm install tsx --save-dev

# Create the table
echo "Creating rate_limit_snapshots table..."
mysql -h\${DB_HOST} -u\${DB_USER} -p\${DB_PASSWORD} \${DB_NAME} 2>&1 <<'SQL' | grep -v "Using a password" || true
CREATE TABLE IF NOT EXISTS rate_limit_snapshots (
  id INT AUTO_INCREMENT PRIMARY KEY,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
  requests_used BIGINT NOT NULL,
  requests_cap BIGINT NOT NULL,
  cum_volume DECIMAL(18,2) NOT NULL,
  requests_delta INT DEFAULT 0,
  volume_delta DECIMAL(18,2) DEFAULT 0,
  requests_per_dollar DECIMAL(10,4) DEFAULT NULL,
  headroom INT GENERATED ALWAYS AS (requests_cap - requests_used) STORED,
  utilization_pct DECIMAL(5,2) GENERATED ALWAYS AS (requests_used / requests_cap * 100) STORED,
  INDEX idx_timestamp (timestamp),
  INDEX idx_utilization (utilization_pct)
);
SQL

echo "✓ Table created/verified"
echo ""

# Stop existing PM2 process if running
echo "Checking for existing PM2 process..."
if pm2 list | grep -q "$PM2_APP_NAME"; then
  echo "Stopping existing $PM2_APP_NAME..."
  pm2 stop $PM2_APP_NAME 2>/dev/null || true
  pm2 delete $PM2_APP_NAME 2>/dev/null || true
fi

# Start with PM2
echo "Starting $PM2_APP_NAME with PM2..."
pm2 start npm --name "$PM2_APP_NAME" -- run monitor:rate-limit

# Save PM2 configuration
pm2 save

echo ""
echo "✓ PM2 process started"
echo ""

# Show status
echo "PM2 Status:"
echo "========================================="
pm2 list | grep -E "(Name|$PM2_APP_NAME)"
echo "========================================="
EOSSH

echo -e "${GREEN}✓ PM2 configured${NC}"
echo ""

# Step 3: Show logs briefly
echo -e "${YELLOW}Step 3: Showing initial logs...${NC}"
echo ""

ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "$EC2_USER@$EC2_IP" \
  "pm2 logs $PM2_APP_NAME --lines 20 --nostream" 2>/dev/null || true

echo ""

# Final summary
echo "========================================="
echo -e "${GREEN}✓ Deployment Successful!${NC}"
echo "========================================="
echo ""
echo "Summary:"
echo "  ✓ rate_limit_snapshots table created"
echo "  ✓ Rate limit monitor running with PM2"
echo "  ✓ Polls every 60 seconds"
echo ""
echo "PM2 Commands (on EC2):"
echo "  • View logs:     pm2 logs $PM2_APP_NAME"
echo "  • Status:        pm2 status"
echo "  • Restart:       pm2 restart $PM2_APP_NAME"
echo "  • Stop:          pm2 stop $PM2_APP_NAME"
echo ""
echo "Grafana Queries:"
echo "  • Utilization:   SELECT timestamp, utilization_pct FROM rate_limit_snapshots"
echo "  • Efficiency:    SELECT timestamp, requests_per_dollar FROM rate_limit_snapshots"
echo "  • Headroom:      SELECT timestamp, headroom FROM rate_limit_snapshots"
echo ""
echo "To view live logs:"
echo "  ssh -i $SSH_KEY $EC2_USER@$EC2_IP 'pm2 logs $PM2_APP_NAME'"
echo ""
