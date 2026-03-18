#!/bin/bash
# Backfill historical user trades from Hyperliquid
# Fetches up to 10,000 most recent trades using userFillsByTime API

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_ROOT"

echo "========================================="
echo "  Backfill User Trades"
echo "========================================="
echo ""

# Run the TypeScript backfill script
npx tsx src/backfill-user-trades.ts

echo ""
echo "========================================="
echo "✓ Backfill complete"
echo "========================================="
