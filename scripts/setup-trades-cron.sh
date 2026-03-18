#!/bin/bash
# scripts/setup-trades-cron.sh
# Sets up a cron job to fetch trades every 5 minutes

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "========================================="
echo "  Trade Fetcher Cron Setup"
echo "========================================="
echo ""

# Get the absolute path to the project directory
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FETCH_SCRIPT="${PROJECT_DIR}/scripts/fetch-trades.sh"
LOG_DIR="${PROJECT_DIR}/logs"
LOG_FILE="${LOG_DIR}/fetch-trades.log"

echo "Project Directory: ${PROJECT_DIR}"
echo "Fetch Script: ${FETCH_SCRIPT}"
echo "Log File: ${LOG_FILE}"
echo ""

# Verify fetch script exists
if [ ! -f "${FETCH_SCRIPT}" ]; then
  echo -e "${RED}Error: fetch-trades.sh not found at ${FETCH_SCRIPT}${NC}"
  exit 1
fi

# Make fetch script executable
chmod +x "${FETCH_SCRIPT}"
echo -e "${GREEN}✓ Made fetch-trades.sh executable${NC}"

# Create logs directory
mkdir -p "${LOG_DIR}"
echo -e "${GREEN}✓ Created logs directory${NC}"
echo ""

# Cron schedule: Run every 5 minutes
CRON_SCHEDULE="*/5 * * * *"
CRON_COMMAND="cd ${PROJECT_DIR} && ${FETCH_SCRIPT} >> ${LOG_FILE} 2>&1"
CRON_JOB="${CRON_SCHEDULE} ${CRON_COMMAND}"

# Check if cron job already exists
if crontab -l 2>/dev/null | grep -q "${FETCH_SCRIPT}"; then
  echo -e "${YELLOW}⚠ Cron job already exists. Removing old entry...${NC}"
  # Remove old entry
  crontab -l 2>/dev/null | grep -v "${FETCH_SCRIPT}" | crontab -
  echo -e "${GREEN}✓ Removed old cron job${NC}"
fi

# Add new cron job
echo "Adding new cron job..."
(crontab -l 2>/dev/null; echo "# Trade fetcher - runs every 5 minutes") | crontab -
(crontab -l 2>/dev/null; echo "${CRON_JOB}") | crontab -

echo -e "${GREEN}✓ Cron job installed successfully!${NC}"
echo ""

# Show current crontab
echo "Current crontab:"
echo "========================================="
crontab -l
echo "========================================="
echo ""

# Show schedule in human-readable format
echo "Schedule Details:"
echo "  • Runs every 5 minutes"
echo "  • Fetches recent trades for all pairs"
echo "  • Upserts to 'trades' table"
echo "  • Logs output to: ${LOG_FILE}"
echo ""

# Test run option
echo "========================================="
echo "Would you like to test the trade fetcher now? (y/n)"
read -r response
if [[ "$response" =~ ^[Yy]$ ]]; then
  echo ""
  echo "Running test fetch..."
  echo "========================================="
  cd "${PROJECT_DIR}"
  bash "${FETCH_SCRIPT}"
else
  echo ""
  echo "Skipping test run."
fi

echo ""
echo "========================================="
echo -e "${GREEN}✓ Setup complete!${NC}"
echo "========================================="
echo ""
echo "Manual Commands:"
echo "  • View logs:   tail -f ${LOG_FILE}"
echo "  • Test run:    cd ${PROJECT_DIR} && ${FETCH_SCRIPT}"
echo "  • Edit cron:   crontab -e"
echo "  • List cron:   crontab -l"
echo ""
