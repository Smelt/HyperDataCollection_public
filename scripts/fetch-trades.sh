#!/bin/bash
# scripts/fetch-trades.sh
# Fetch recent trades from Hyperliquid and upsert to database
# Runs every 5 minutes via cron

set -e

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Navigate to project directory
cd "${SCRIPT_DIR}"

# Run the trade fetcher
npm run fetch:trades 2>&1 | grep -v "npm warn"

exit 0
