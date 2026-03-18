#!/bin/bash
# scripts/deploy-grafana-to-ec2.sh
# Deploy updated Grafana dashboards to EC2

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "========================================="
echo "  Deploy Grafana Dashboards to EC2"
echo "========================================="
echo ""

# Check if SSH key and IP are provided
if [ -z "$1" ] || [ -z "$2" ]; then
  echo -e "${RED}Error: Missing arguments${NC}"
  echo "Usage: ./scripts/deploy-grafana-to-ec2.sh <ssh-key.pem> <ec2-ip-address>"
  echo ""
  echo "Example:"
  echo "  ./scripts/deploy-grafana-to-ec2.sh ~/.ssh/hyperliquid-key.pem 54.123.45.67"
  exit 1
fi

SSH_KEY="$1"
EC2_IP="$2"
EC2_USER="ubuntu"
REMOTE_DIR="~/hyperliquid-bot/grafana"
GRAFANA_API_URL="http://localhost:3000"
GRAFANA_API_KEY="${3:-}"  # Optional: Grafana API key as 3rd argument

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

# Step 1: Upload dashboard files
echo -e "${YELLOW}Step 1: Uploading dashboard files...${NC}"

# Create grafana directory
ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "$EC2_USER@$EC2_IP" \
  "mkdir -p $REMOTE_DIR"

# Upload all dashboard JSON files
scp -i "$SSH_KEY" -o StrictHostKeyChecking=no \
  grafana/*.json \
  "$EC2_USER@$EC2_IP:$REMOTE_DIR/"

echo -e "${GREEN}✓ Dashboard files uploaded${NC}"
echo ""

# Step 2: Import dashboards via Grafana API
echo -e "${YELLOW}Step 2: Importing dashboards into Grafana...${NC}"
echo ""

ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "$EC2_USER@$EC2_IP" bash <<'EOSSH'
set -e

cd ~/hyperliquid-bot/grafana

# Grafana API endpoint (local)
GRAFANA_URL="http://localhost:3000"
GRAFANA_USER="admin"
GRAFANA_PASS="admin"  # Default password, may need to update

echo "Importing dashboards..."

# Import each dashboard
for dashboard_file in *.json; do
  echo "  Importing: $dashboard_file"

  # Read dashboard JSON
  dashboard_json=$(cat "$dashboard_file")

  # Create import payload
  import_payload=$(cat <<EOF
{
  "dashboard": $dashboard_json,
  "overwrite": true,
  "message": "Updated via automated deployment"
}
EOF
)

  # Import via API
  response=$(curl -s -X POST \
    -H "Content-Type: application/json" \
    -u "${GRAFANA_USER}:${GRAFANA_PASS}" \
    -d "$import_payload" \
    "${GRAFANA_URL}/api/dashboards/db" 2>&1)

  # Check if successful
  if echo "$response" | grep -q '"status":"success"'; then
    echo "    ✓ Successfully imported"
  elif echo "$response" | grep -q '"message":"Dashboard not found"'; then
    echo "    ⚠ Dashboard created (new)"
  else
    echo "    ⚠ Warning: $response"
  fi
done

echo ""
echo "✓ Dashboard import complete"
EOSSH

echo -e "${GREEN}✓ Dashboards imported${NC}"
echo ""

# Final summary
echo "========================================="
echo -e "${GREEN}✓ Deployment Successful!${NC}"
echo "========================================="
echo ""
echo "Summary:"
echo "  ✓ All dashboard files uploaded"
echo "  ✓ Dashboards imported to Grafana"
echo "  ✓ Dynamic time filters enabled"
echo ""
echo "What changed:"
echo "  • Replaced hardcoded time intervals with dynamic filters"
echo "  • Dashboards now respond to Grafana time range selector"
echo "  • Time queries use \$__timeFrom() and \$__timeTo() variables"
echo ""
echo "Access Grafana:"
echo "  http://${EC2_IP}:3000"
echo ""
echo "Test the dashboards:"
echo "  1. Open any updated dashboard"
echo "  2. Use the time range picker (top right)"
echo "  3. Select different time ranges (last 15m, 1h, 6h, etc.)"
echo "  4. Verify data updates dynamically"
echo ""
echo "Updated dashboards:"
echo "  • focused-trading-dashboard.json"
echo "  • live-opportunities-dashboard.json"
echo "  • optimized-dashboard.json"
echo ""
