#!/bin/bash
# scripts/setup-aggregate-cron.sh
# Sets up a cron job to aggregate data every minute

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "========================================="
echo "  1-Minute Aggregation Cron Setup"
echo "========================================="
echo ""

# Get the absolute path to the project directory
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AGGREGATE_SCRIPT="${PROJECT_DIR}/scripts/aggregate-1min.sh"
LOG_DIR="${PROJECT_DIR}/logs"
LOG_FILE="${LOG_DIR}/aggregate-1min.log"

echo "Project Directory: ${PROJECT_DIR}"
echo "Aggregation Script: ${AGGREGATE_SCRIPT}"
echo "Log File: ${LOG_FILE}"
echo ""

# Verify aggregation script exists
if [ ! -f "${AGGREGATE_SCRIPT}" ]; then
  echo -e "${RED}Error: aggregate-1min.sh not found at ${AGGREGATE_SCRIPT}${NC}"
  exit 1
fi

# Make aggregation script executable
chmod +x "${AGGREGATE_SCRIPT}"
echo -e "${GREEN}✓ Made aggregate-1min.sh executable${NC}"

# Create logs directory
mkdir -p "${LOG_DIR}"
echo -e "${GREEN}✓ Created logs directory${NC}"
echo ""

# Cron schedule: Run every minute
# Format: minute hour day-of-month month day-of-week
CRON_SCHEDULE="* * * * *"
CRON_COMMAND="cd ${PROJECT_DIR} && ${AGGREGATE_SCRIPT} >> ${LOG_FILE} 2>&1"
CRON_JOB="${CRON_SCHEDULE} ${CRON_COMMAND}"

# Check if cron job already exists
if crontab -l 2>/dev/null | grep -q "${AGGREGATE_SCRIPT}"; then
  echo -e "${YELLOW}⚠ Cron job already exists. Removing old entry...${NC}"
  # Remove old entry
  crontab -l 2>/dev/null | grep -v "${AGGREGATE_SCRIPT}" | crontab -
  echo -e "${GREEN}✓ Removed old cron job${NC}"
fi

# Add new cron job
echo "Adding new cron job..."
(crontab -l 2>/dev/null; echo "# 1-minute data aggregation - runs every minute") | crontab -
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
echo "  • Runs every minute"
echo "  • Aggregates 5-second snapshots into 1-minute windows"
echo "  • Stores min/max/avg price and spread per pair"
echo "  • Logs output to: ${LOG_FILE}"
echo ""

# Test run option
echo "========================================="
echo "Would you like to test the aggregation script now? (y/n)"
read -r response
if [[ "$response" =~ ^[Yy]$ ]]; then
  echo ""
  echo "Running test aggregation..."
  echo "========================================="
  cd "${PROJECT_DIR}"
  bash "${AGGREGATE_SCRIPT}"
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
echo "  • Test run:    cd ${PROJECT_DIR} && ${AGGREGATE_SCRIPT}"
echo "  • Edit cron:   crontab -e"
echo "  • List cron:   crontab -l"
echo ""
