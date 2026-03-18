#!/bin/bash
# scripts/deploy-cleanup-to-ec2.sh
# Deploy database cleanup scripts and set up cron job on EC2

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "========================================="
echo "  Deploy Database Cleanup to EC2"
echo "========================================="
echo ""

# Check if SSH key and IP are provided
if [ -z "$1" ] || [ -z "$2" ]; then
  echo -e "${RED}Error: Missing arguments${NC}"
  echo "Usage: ./scripts/deploy-cleanup-to-ec2.sh <ssh-key.pem> <ec2-ip-address>"
  echo ""
  echo "Example:"
  echo "  ./scripts/deploy-cleanup-to-ec2.sh ~/.ssh/hyperliquid-key.pem 54.123.45.67"
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
  echo "Please check:"
  echo "  1. EC2 instance is running"
  echo "  2. Security group allows SSH from your IP"
  echo "  3. SSH key permissions: chmod 400 $SSH_KEY"
  exit 1
fi
echo ""

# Upload cleanup scripts
echo -e "${YELLOW}Uploading cleanup scripts...${NC}"
scp -i "$SSH_KEY" -o StrictHostKeyChecking=no \
  scripts/cleanup.sh \
  scripts/setup-cleanup-cron.sh \
  "$EC2_USER@$EC2_IP:$REMOTE_DIR/scripts/"

echo -e "${GREEN}✓ Scripts uploaded${NC}"
echo ""

# Run setup on EC2
echo -e "${YELLOW}Setting up cron job on EC2...${NC}"
echo ""
ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "$EC2_USER@$EC2_IP" bash <<'EOSSH'
set -e

cd ~/hyperliquid-bot

# Make scripts executable
chmod +x scripts/cleanup.sh
chmod +x scripts/setup-cleanup-cron.sh

# Run cron setup (non-interactive)
echo "Running cron setup..."
echo ""

# Get absolute paths
PROJECT_DIR="$(pwd)"
CLEANUP_SCRIPT="${PROJECT_DIR}/scripts/cleanup.sh"
LOG_DIR="${PROJECT_DIR}/logs"
LOG_FILE="${LOG_DIR}/cleanup.log"

# Create logs directory
mkdir -p "${LOG_DIR}"
echo "✓ Created logs directory: ${LOG_DIR}"

# Cron schedule: Run every Sunday at 2:00 AM
CRON_SCHEDULE="0 2 * * 0"
CRON_COMMAND="cd ${PROJECT_DIR} && ${CLEANUP_SCRIPT} >> ${LOG_FILE} 2>&1"
CRON_JOB="${CRON_SCHEDULE} ${CRON_COMMAND}"

# Remove old cron job if exists
if crontab -l 2>/dev/null | grep -q "${CLEANUP_SCRIPT}"; then
  echo "Removing old cron job..."
  crontab -l 2>/dev/null | grep -v "${CLEANUP_SCRIPT}" | crontab - || true
fi

# Add new cron job
echo "Installing cron job..."
(crontab -l 2>/dev/null | grep -v "^# Database cleanup" || true; echo "# Database cleanup - runs every Sunday at 2:00 AM") | crontab -
(crontab -l 2>/dev/null; echo "${CRON_JOB}") | crontab -

echo "✓ Cron job installed"
echo ""

# Show crontab
echo "Current crontab:"
echo "========================================="
crontab -l | tail -5
echo "========================================="
echo ""

echo "Schedule Details:"
echo "  • Runs every Sunday at 2:00 AM"
echo "  • Deletes spread_snapshots older than 31 days"
echo "  • Logs output to: ${LOG_FILE}"
echo ""

# Check if MySQL client is installed
if ! command -v mysql &> /dev/null; then
  echo "⚠ WARNING: MySQL client not installed!"
  echo "Install it with: sudo apt-get install -y mysql-client"
  echo ""
fi

echo "Manual Commands:"
echo "  • Test run:    cd ${PROJECT_DIR} && ./scripts/cleanup.sh"
echo "  • View logs:   tail -f ${LOG_FILE}"
echo "  • List cron:   crontab -l"
echo ""

EOSSH

echo -e "${GREEN}✓ Cron setup complete${NC}"
echo ""

# Ask if user wants to test
echo "========================================="
echo "Would you like to run a test cleanup now? (y/n)"
read -r response
if [[ "$response" =~ ^[Yy]$ ]]; then
  echo ""
  echo "Running test cleanup on EC2..."
  echo "========================================="
  ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "$EC2_USER@$EC2_IP" \
    "cd ~/hyperliquid-bot && ./scripts/cleanup.sh"
else
  echo ""
  echo "Skipping test run."
fi

echo ""
echo "========================================="
echo -e "${GREEN}✓ Deployment Successful!${NC}"
echo "========================================="
echo ""
echo "The database cleanup is now configured to run every Sunday at 2:00 AM"
echo "Retention policy: Keep last 31 days of spread_snapshots"
echo ""
echo "To manually run cleanup:"
echo "  ssh -i $SSH_KEY $EC2_USER@$EC2_IP"
echo "  cd ~/hyperliquid-bot && ./scripts/cleanup.sh"
echo ""
echo "To view cleanup logs:"
echo "  ssh -i $SSH_KEY $EC2_USER@$EC2_IP"
echo "  tail -f ~/hyperliquid-bot/logs/cleanup.log"
echo ""
