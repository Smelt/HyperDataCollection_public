#!/bin/bash
# scripts/deploy-to-ec2.sh
# Deploy application to EC2 instance

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "========================================="
echo "  Deploy to EC2"
echo "========================================="
echo ""

# Check if SSH key and IP are provided
if [ -z "$1" ] || [ -z "$2" ]; then
  echo -e "${RED}Error: Missing arguments${NC}"
  echo "Usage: ./scripts/deploy-to-ec2.sh <ssh-key.pem> <ec2-ip-address>"
  echo ""
  echo "Example:"
  echo "  ./scripts/deploy-to-ec2.sh ~/Downloads/my-key.pem 54.123.45.67"
  exit 1
fi

SSH_KEY="$1"
EC2_IP="$2"
EC2_USER="ubuntu"

# Validate SSH key exists
if [ ! -f "$SSH_KEY" ]; then
  echo -e "${RED}Error: SSH key not found: $SSH_KEY${NC}"
  exit 1
fi

echo "Configuration:"
echo "  SSH Key: $SSH_KEY"
echo "  EC2 IP: $EC2_IP"
echo "  User: $EC2_USER"
echo ""

# Create deployment package
echo -e "${YELLOW}Creating deployment package...${NC}"
PACKAGE_NAME="hyperliquid-bot-$(date +%Y%m%d-%H%M%S).tar.gz"

tar -czf "$PACKAGE_NAME" \
  --exclude=node_modules \
  --exclude=data \
  --exclude=backups \
  --exclude=.git \
  --exclude=*.log \
  --exclude=.DS_Store \
  --exclude=dist \
  --exclude=*.tar.gz \
  .

PACKAGE_SIZE=$(du -h "$PACKAGE_NAME" | cut -f1)
echo -e "${GREEN}✓ Package created: $PACKAGE_NAME ($PACKAGE_SIZE)${NC}"
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

# Upload package
echo -e "${YELLOW}Uploading package to EC2...${NC}"
scp -i "$SSH_KEY" -o StrictHostKeyChecking=no "$PACKAGE_NAME" "$EC2_USER@$EC2_IP:~/"
echo -e "${GREEN}✓ Package uploaded${NC}"
echo ""

# Deploy on EC2
echo -e "${YELLOW}Deploying on EC2...${NC}"
ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "$EC2_USER@$EC2_IP" bash <<EOF
set -e

echo "=== Deployment on EC2 ==="

# Stop existing application if running
if pm2 list | grep -q "hyperliquid-bot"; then
  echo "Stopping existing application..."
  pm2 stop hyperliquid-bot || true
fi

# Backup existing installation
if [ -d ~/hyperliquid-bot ]; then
  echo "Backing up existing installation..."
  mv ~/hyperliquid-bot ~/hyperliquid-bot.backup-\$(date +%Y%m%d-%H%M%S)
fi

# Create directory and extract
echo "Extracting package..."
mkdir -p ~/hyperliquid-bot
tar -xzf ~/$PACKAGE_NAME -C ~/hyperliquid-bot

# Go to directory
cd ~/hyperliquid-bot

# Install dependencies
echo "Installing dependencies..."
npm install --production

# Build TypeScript (if needed)
if [ -f "tsconfig.json" ]; then
  echo "Building TypeScript..."
  npm run build
fi

# Start with PM2
echo "Starting application with PM2..."
pm2 start npm --name "hyperliquid-bot" -- start

# Save PM2 configuration
pm2 save

# Show status
echo ""
echo "=== Application Status ==="
pm2 status

echo ""
echo "=== Recent Logs ==="
pm2 logs hyperliquid-bot --lines 20 --nostream

# Cleanup
rm -f ~/$PACKAGE_NAME
EOF

echo -e "${GREEN}✓ Deployment complete${NC}"
echo ""

# Cleanup local package
rm -f "$PACKAGE_NAME"

# Show final status
echo "========================================="
echo -e "${GREEN}✓ Deployment Successful!${NC}"
echo "========================================="
echo ""
echo "Application is now running on EC2"
echo ""
echo "To view logs:"
echo "  ssh -i $SSH_KEY $EC2_USER@$EC2_IP"
echo "  pm2 logs hyperliquid-bot"
echo ""
echo "To check status:"
echo "  ssh -i $SSH_KEY $EC2_USER@$EC2_IP"
echo "  ~/status.sh"
echo ""
echo "========================================="
