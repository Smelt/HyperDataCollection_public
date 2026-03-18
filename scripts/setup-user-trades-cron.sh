#!/bin/bash
# Setup cron job to fetch user trades every minute

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo "========================================="
echo "  Setup User Trades Cron Job"
echo "========================================="
echo ""

# Check if cron job already exists
if crontab -l 2>/dev/null | grep -q "fetch-user-trades.sh"; then
    echo "⚠️  Cron job already exists"
    echo ""
    echo "Current cron jobs:"
    crontab -l | grep "fetch-user-trades"
    echo ""
    read -p "Do you want to replace it? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Aborted"
        exit 1
    fi

    # Remove existing cron job
    crontab -l | grep -v "fetch-user-trades.sh" | crontab -
fi

# Add new cron job (runs every minute)
(crontab -l 2>/dev/null; echo "* * * * * cd $PROJECT_ROOT && ./scripts/fetch-user-trades.sh >> /tmp/fetch-user-trades.log 2>&1") | crontab -

echo "✓ Cron job installed"
echo ""
echo "Schedule: Every minute"
echo "Script: $SCRIPT_DIR/fetch-user-trades.sh"
echo "Log: /tmp/fetch-user-trades.log"
echo ""
echo "To view logs: tail -f /tmp/fetch-user-trades.log"
echo "To list cron jobs: crontab -l"
echo "To remove cron job: crontab -e"
echo ""
echo "========================================="
