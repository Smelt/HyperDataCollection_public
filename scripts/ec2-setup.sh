#!/bin/bash
# scripts/ec2-setup.sh
# Initial setup script for EC2 instance
# Run this once on a fresh Ubuntu 22.04 instance

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "========================================="
echo "  Hyperliquid Bot - EC2 Setup"
echo "========================================="
echo ""

# Update system
echo -e "${YELLOW}Updating system packages...${NC}"
sudo apt update
sudo apt upgrade -y

# Install essential packages
echo -e "${YELLOW}Installing essential packages...${NC}"
sudo apt install -y \
  curl \
  wget \
  git \
  build-essential \
  ca-certificates \
  gnupg \
  mysql-client

echo -e "${GREEN}✓ Essential packages installed${NC}"
echo ""

# Install Node.js 18.x
echo -e "${YELLOW}Installing Node.js 18.x...${NC}"
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs

# Verify installation
NODE_VERSION=$(node --version)
NPM_VERSION=$(npm --version)
echo -e "${GREEN}✓ Node.js installed: ${NODE_VERSION}${NC}"
echo -e "${GREEN}✓ npm installed: ${NPM_VERSION}${NC}"
echo ""

# Install PM2 globally
echo -e "${YELLOW}Installing PM2 process manager...${NC}"
sudo npm install -g pm2
echo -e "${GREEN}✓ PM2 installed: $(pm2 --version)${NC}"
echo ""

# Create application directory
echo -e "${YELLOW}Creating application directory...${NC}"
mkdir -p ~/hyperliquid-bot/data
mkdir -p ~/hyperliquid-bot/backups
mkdir -p ~/hyperliquid-bot/logs
echo -e "${GREEN}✓ Directories created${NC}"
echo ""

# Configure system limits for Node.js
echo -e "${YELLOW}Configuring system limits...${NC}"
sudo tee -a /etc/security/limits.conf > /dev/null <<EOF

# Hyperliquid Bot - Increase file descriptors
* soft nofile 65536
* hard nofile 65536
EOF

# Set ulimit for current session
ulimit -n 65536

echo -e "${GREEN}✓ System limits configured${NC}"
echo ""

# Install timezone data and set to JST (for ap-northeast-1)
echo -e "${YELLOW}Setting timezone to Asia/Tokyo...${NC}"
sudo timedatectl set-timezone Asia/Tokyo
echo -e "${GREEN}✓ Timezone set to: $(timedatectl | grep 'Time zone')${NC}"
echo ""

# Create log rotation configuration
echo -e "${YELLOW}Setting up log rotation...${NC}"
sudo tee /etc/logrotate.d/hyperliquid-bot > /dev/null <<EOF
/home/ubuntu/hyperliquid-bot/logs/*.log {
    daily
    missingok
    rotate 7
    compress
    delaycompress
    notifempty
    create 0640 ubuntu ubuntu
}
EOF

echo -e "${GREEN}✓ Log rotation configured${NC}"
echo ""

# Configure git (if using git deployment)
echo -e "${YELLOW}Configuring git...${NC}"
git config --global credential.helper store
git config --global pull.rebase false
echo -e "${GREEN}✓ Git configured${NC}"
echo ""

# Install AWS CLI (useful for SSM parameters, S3, etc.)
echo -e "${YELLOW}Installing AWS CLI...${NC}"
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
unzip -q awscliv2.zip
sudo ./aws/install
rm -rf aws awscliv2.zip
echo -e "${GREEN}✓ AWS CLI installed: $(aws --version)${NC}"
echo ""

# Create systemd service file (alternative to PM2)
echo -e "${YELLOW}Creating systemd service...${NC}"
sudo tee /etc/systemd/system/hyperliquid-bot.service > /dev/null <<EOF
[Unit]
Description=Hyperliquid Market Making Bot
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/hyperliquid-bot
Environment=NODE_ENV=production
ExecStart=/usr/bin/node /home/ubuntu/hyperliquid-bot/dist/index.js
Restart=always
RestartSec=10
StandardOutput=append:/home/ubuntu/hyperliquid-bot/logs/bot.log
StandardError=append:/home/ubuntu/hyperliquid-bot/logs/bot-error.log

# Security
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
echo -e "${GREEN}✓ Systemd service created (not enabled yet)${NC}"
echo ""

# Set up firewall (UFW)
echo -e "${YELLOW}Configuring firewall...${NC}"
sudo ufw --force enable
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow ssh
sudo ufw allow from any to any port 3306 proto tcp  # MySQL (if needed)
sudo ufw status
echo -e "${GREEN}✓ Firewall configured${NC}"
echo ""

# Install monitoring tools
echo -e "${YELLOW}Installing monitoring tools...${NC}"
sudo apt install -y htop iotop nethogs
echo -e "${GREEN}✓ Monitoring tools installed${NC}"
echo ""

# Performance tuning
echo -e "${YELLOW}Applying performance tuning...${NC}"

# Increase TCP buffer sizes
sudo tee -a /etc/sysctl.conf > /dev/null <<EOF

# Hyperliquid Bot - TCP Performance Tuning
net.core.rmem_max = 134217728
net.core.wmem_max = 134217728
net.ipv4.tcp_rmem = 4096 87380 67108864
net.ipv4.tcp_wmem = 4096 65536 67108864
net.ipv4.tcp_congestion_control = bbr
EOF

sudo sysctl -p
echo -e "${GREEN}✓ Performance tuning applied${NC}"
echo ""

# Create helper scripts
echo -e "${YELLOW}Creating helper scripts...${NC}"

# Deployment helper
cat > ~/deploy.sh <<'EOF'
#!/bin/bash
# Quick deployment script

echo "Pulling latest changes..."
cd ~/hyperliquid-bot
git pull

echo "Installing dependencies..."
npm install

echo "Restarting application..."
pm2 restart hyperliquid-bot

echo "✓ Deployment complete"
pm2 logs hyperliquid-bot --lines 20
EOF

chmod +x ~/deploy.sh

# Status check helper
cat > ~/status.sh <<'EOF'
#!/bin/bash
# Quick status check

echo "=== Application Status ==="
pm2 status

echo ""
echo "=== Recent Logs ==="
pm2 logs hyperliquid-bot --lines 10 --nostream

echo ""
echo "=== Database Connection ==="
cd ~/hyperliquid-bot
source .env 2>/dev/null
if [ -n "$DB_HOST" ]; then
  mysql -h"${DB_HOST}" -u"${DB_USER}" -p"${DB_PASSWORD}" ${DB_NAME} -e "SELECT COUNT(*) as total_snapshots FROM spread_snapshots;" 2>/dev/null || echo "Cannot connect to database"
else
  echo ".env file not found"
fi

echo ""
echo "=== Disk Usage ==="
df -h | grep -E '/$|/home'

echo ""
echo "=== Memory Usage ==="
free -h
EOF

chmod +x ~/status.sh

echo -e "${GREEN}✓ Helper scripts created (~/deploy.sh, ~/status.sh)${NC}"
echo ""

# Print summary
echo "========================================="
echo -e "${GREEN}✓ EC2 Setup Complete!${NC}"
echo "========================================="
echo ""
echo "Installed:"
echo "  • Node.js ${NODE_VERSION}"
echo "  • npm ${NPM_VERSION}"
echo "  • PM2 process manager"
echo "  • MySQL client"
echo "  • AWS CLI"
echo "  • Git"
echo "  • Monitoring tools (htop, iotop, nethogs)"
echo ""
echo "Next steps:"
echo "  1. Deploy your application to ~/hyperliquid-bot"
echo "  2. Configure .env file"
echo "  3. Install dependencies: cd ~/hyperliquid-bot && npm install"
echo "  4. Start with PM2: pm2 start npm --name 'hyperliquid-bot' -- start"
echo "  5. Save PM2: pm2 save && pm2 startup"
echo ""
echo "Helper commands:"
echo "  • ~/status.sh    - Check application status"
echo "  • ~/deploy.sh    - Quick deploy (if using git)"
echo "  • pm2 logs hyperliquid-bot  - View logs"
echo "  • pm2 monit      - Monitor resources"
echo ""
echo "See EC2_DEPLOYMENT.md for full documentation"
echo "========================================="
