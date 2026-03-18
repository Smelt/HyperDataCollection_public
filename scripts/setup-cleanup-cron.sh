#!/bin/bash
# scripts/setup-cleanup-cron.sh
# Sets up a weekly cron job to clean up old database data

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "========================================="
echo "  Database Cleanup Cron Setup"
echo "========================================="
echo ""

# Get the absolute path to the project directory
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLEANUP_SCRIPT="${PROJECT_DIR}/scripts/cleanup.sh"
LOG_DIR="${PROJECT_DIR}/logs"
LOG_FILE="${LOG_DIR}/cleanup.log"

echo "Project Directory: ${PROJECT_DIR}"
echo "Cleanup Script: ${CLEANUP_SCRIPT}"
echo "Log File: ${LOG_FILE}"
echo ""

# Verify cleanup script exists
if [ ! -f "${CLEANUP_SCRIPT}" ]; then
  echo -e "${RED}Error: cleanup.sh not found at ${CLEANUP_SCRIPT}${NC}"
  exit 1
fi

# Make cleanup script executable
chmod +x "${CLEANUP_SCRIPT}"
echo -e "${GREEN}✓ Made cleanup.sh executable${NC}"

# Create logs directory
mkdir -p "${LOG_DIR}"
echo -e "${GREEN}✓ Created logs directory${NC}"
echo ""

# Cron schedule: Run every Sunday at 2:00 AM
# Format: minute hour day-of-month month day-of-week
CRON_SCHEDULE="0 2 * * 0"
CRON_COMMAND="cd ${PROJECT_DIR} && ${CLEANUP_SCRIPT} >> ${LOG_FILE} 2>&1"
CRON_JOB="${CRON_SCHEDULE} ${CRON_COMMAND}"

# Check if cron job already exists
if crontab -l 2>/dev/null | grep -q "${CLEANUP_SCRIPT}"; then
  echo -e "${YELLOW}⚠ Cron job already exists. Removing old entry...${NC}"
  # Remove old entry
  crontab -l 2>/dev/null | grep -v "${CLEANUP_SCRIPT}" | crontab -
  echo -e "${GREEN}✓ Removed old cron job${NC}"
fi

# Add new cron job
echo "Adding new cron job..."
(crontab -l 2>/dev/null; echo "# Database cleanup - runs every Sunday at 2:00 AM") | crontab -
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
echo "  • Runs every Sunday at 2:00 AM"
echo "  • Deletes spread_snapshots older than 31 days"
echo "  • Logs output to: ${LOG_FILE}"
echo ""

# Show next scheduled run
echo "Next scheduled runs:"
# Calculate next Sunday 2 AM
if command -v date &> /dev/null; then
  # This works on Linux (date with -d flag)
  if date -d "next sunday 02:00" &> /dev/null; then
    NEXT_RUN=$(date -d "next sunday 02:00" "+%Y-%m-%d %H:%M %Z")
    echo "  • ${NEXT_RUN}"
  else
    # macOS doesn't support -d flag, just show generic message
    echo "  • Next Sunday at 2:00 AM"
  fi
fi
echo ""

# Test run option
echo "========================================="
echo "Would you like to test the cleanup script now? (y/n)"
read -r response
if [[ "$response" =~ ^[Yy]$ ]]; then
  echo ""
  echo "Running test cleanup..."
  echo "========================================="
  cd "${PROJECT_DIR}"
  bash "${CLEANUP_SCRIPT}"
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
echo "  • Test run:    cd ${PROJECT_DIR} && ${CLEANUP_SCRIPT}"
echo "  • Edit cron:   crontab -e"
echo "  • List cron:   crontab -l"
echo "  • Remove cron: crontab -r"
echo ""
