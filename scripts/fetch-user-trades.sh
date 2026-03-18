#!/bin/bash
# Fetch user trades from Hyperliquid and upsert to database
# Runs every minute via cron

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_ROOT"

# Run the TypeScript script
npx tsx src/fetch-user-trades.ts
