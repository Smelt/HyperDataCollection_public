#!/bin/bash
# Trading Bot Status Script
# Shows running processes and checks log freshness
#
# Usage: ./scripts/status.sh
#        LOG_DIR=/path/to/logs ./scripts/status.sh

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Config - adjust paths for your server
LOG_DIR="${LOG_DIR:-/home/ubuntu}"
STALE_THRESHOLD_SEC=60  # Logs older than this are considered stale

echo ""
echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}  TRADING BOT STATUS - $(date '+%Y-%m-%d %H:%M:%S')${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"
echo ""

# ─────────────────────────────────────────────────────────────
# RUNNING PROCESSES
# ─────────────────────────────────────────────────────────────
echo -e "${YELLOW}📊 RUNNING PROCESSES${NC}"
echo "───────────────────────────────────────────────────────────"

# Trading bot executors
EXECUTORS=$(ps aux | grep -E "executor\.ts" | grep -v grep)
if [ -n "$EXECUTORS" ]; then
    echo -e "${GREEN}Trading Executors:${NC}"
    echo "$EXECUTORS" | while read line; do
        # Extract currency and size from command
        CURRENCY=$(echo "$line" | grep -oE "executor\.ts [A-Z]+" | awk '{print $2}')
        SIZE=$(echo "$line" | grep -oE "\-s [0-9]+" | awk '{print $2}')
        PID=$(echo "$line" | awk '{print $2}')
        CPU=$(echo "$line" | awk '{print $3}')
        MEM=$(echo "$line" | awk '{print $4}')
        START=$(echo "$line" | awk '{print $9}')

        if [ -n "$CURRENCY" ]; then
            echo -e "  ${GREEN}●${NC} ${BOLD}${CURRENCY}${NC} (size: \$${SIZE:-15}) | PID: ${PID} | CPU: ${CPU}% | MEM: ${MEM}% | Started: ${START}"
        fi
    done
else
    echo -e "  ${RED}✗ No trading executors running${NC}"
fi

echo ""

# Data collection
DATA_COLLECTOR=$(ps aux | grep -E "hyperliquid-bot.*index\.ts" | grep -v grep | head -1)
if [ -n "$DATA_COLLECTOR" ]; then
    PID=$(echo "$DATA_COLLECTOR" | awk '{print $2}')
    CPU=$(echo "$DATA_COLLECTOR" | awk '{print $3}')
    MEM=$(echo "$DATA_COLLECTOR" | awk '{print $4}')
    echo -e "${GREEN}Data Collection:${NC}"
    echo -e "  ${GREEN}●${NC} hyperliquid-bot | PID: ${PID} | CPU: ${CPU}% | MEM: ${MEM}%"
else
    echo -e "${RED}Data Collection:${NC}"
    echo -e "  ${RED}✗ Not running${NC}"
fi

echo ""

# Spread API
SPREAD_API=$(ps aux | grep -E "spread-api\.ts" | grep -v grep | head -1)
if [ -n "$SPREAD_API" ]; then
    PID=$(echo "$SPREAD_API" | awk '{print $2}')
    CPU=$(echo "$SPREAD_API" | awk '{print $3}')
    MEM=$(echo "$SPREAD_API" | awk '{print $4}')
    echo -e "${GREEN}Spread API:${NC}"
    echo -e "  ${GREEN}●${NC} spread-api.ts | PID: ${PID} | CPU: ${CPU}% | MEM: ${MEM}%"
else
    echo -e "${RED}Spread API:${NC}"
    echo -e "  ${RED}✗ Not running${NC}"
fi

echo ""

# PM2 processes
PM2_PROCS=$(ps aux | grep -E "pm2" | grep -v grep | wc -l)
if [ "$PM2_PROCS" -gt 0 ]; then
    echo -e "${GREEN}PM2:${NC}"
    echo -e "  ${GREEN}●${NC} ${PM2_PROCS} PM2 processes running"
    # Show PM2 list if available
    if command -v pm2 &> /dev/null || command -v npx &> /dev/null; then
        echo ""
        npx pm2 list 2>/dev/null || pm2 list 2>/dev/null || true
    fi
else
    echo -e "${YELLOW}PM2:${NC}"
    echo -e "  ${YELLOW}○${NC} No PM2 processes detected"
fi

# ─────────────────────────────────────────────────────────────
# LOG HEALTH CHECK
# ─────────────────────────────────────────────────────────────
echo ""
echo -e "${YELLOW}📝 LOG HEALTH CHECK${NC}"
echo "───────────────────────────────────────────────────────────"

check_log() {
    local LOG_FILE=$1
    local LOG_NAME=$2

    if [ ! -f "$LOG_FILE" ]; then
        echo -e "  ${YELLOW}○${NC} ${LOG_NAME}: File not found (${LOG_FILE})"
        return
    fi

    # Get last modification time
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS
        LAST_MOD=$(stat -f %m "$LOG_FILE")
    else
        # Linux
        LAST_MOD=$(stat -c %Y "$LOG_FILE")
    fi

    NOW=$(date +%s)
    AGE=$((NOW - LAST_MOD))

    # Get last log line with timestamp
    LAST_LINE=$(tail -1 "$LOG_FILE" 2>/dev/null | cut -c1-70)

    if [ $AGE -lt $STALE_THRESHOLD_SEC ]; then
        echo -e "  ${GREEN}●${NC} ${BOLD}${LOG_NAME}${NC}: ${GREEN}Active${NC} (${AGE}s ago)"
        echo -e "      └─ ${LAST_LINE}"
    elif [ $AGE -lt 300 ]; then
        echo -e "  ${YELLOW}○${NC} ${BOLD}${LOG_NAME}${NC}: ${YELLOW}Slow${NC} (${AGE}s ago)"
        echo -e "      └─ ${LAST_LINE}"
    else
        AGE_MIN=$((AGE / 60))
        echo -e "  ${RED}✗${NC} ${BOLD}${LOG_NAME}${NC}: ${RED}STALE/HUNG${NC} (${AGE_MIN}m ago)"
        echo -e "      └─ ${LAST_LINE}"
    fi
}

# Check trading executor logs
for COIN in purr mega ace not mon hmstr; do
    LOG_FILE="${LOG_DIR}/${COIN}.log"
    if [ -f "$LOG_FILE" ]; then
        check_log "$LOG_FILE" "$(echo $COIN | tr '[:lower:]' '[:upper:]') Executor"
    fi
done

# Check if any logs were found
FOUND_LOGS=$(ls ${LOG_DIR}/*.log 2>/dev/null | wc -l)
if [ "$FOUND_LOGS" -eq 0 ]; then
    echo -e "  ${YELLOW}No log files found in ${LOG_DIR}${NC}"
    echo -e "  ${YELLOW}Set LOG_DIR env var to specify log directory${NC}"
fi

# ─────────────────────────────────────────────────────────────
# QUICK STATS
# ─────────────────────────────────────────────────────────────
echo ""
echo -e "${YELLOW}💾 SYSTEM RESOURCES${NC}"
echo "───────────────────────────────────────────────────────────"

# Memory usage
if command -v free &> /dev/null; then
    MEM_INFO=$(free -h | grep Mem)
    MEM_USED=$(echo $MEM_INFO | awk '{print $3}')
    MEM_TOTAL=$(echo $MEM_INFO | awk '{print $2}')
    echo -e "  Memory: ${MEM_USED} / ${MEM_TOTAL}"
elif [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS
    MEM_TOTAL=$(sysctl -n hw.memsize | awk '{print $1/1024/1024/1024 "G"}')
    echo -e "  Memory: (use 'top' on macOS) / ${MEM_TOTAL}"
fi

# Disk usage
DISK_USAGE=$(df -h / | tail -1 | awk '{print $5 " used (" $3 " / " $2 ")"}')
echo -e "  Disk:   ${DISK_USAGE}"

# Load average
if [ -f /proc/loadavg ]; then
    LOAD=$(cat /proc/loadavg | awk '{print $1, $2, $3}')
    echo -e "  Load:   ${LOAD}"
elif [[ "$OSTYPE" == "darwin"* ]]; then
    LOAD=$(sysctl -n vm.loadavg | tr -d '{}')
    echo -e "  Load:  ${LOAD}"
fi

# ─────────────────────────────────────────────────────────────
# HELPFUL COMMANDS
# ─────────────────────────────────────────────────────────────
echo ""
echo -e "${YELLOW}📌 QUICK COMMANDS${NC}"
echo "───────────────────────────────────────────────────────────"
echo "  tail -f ${LOG_DIR}/purr.log       # Watch PURR logs"
echo "  ./scripts/trade-review.sh         # Review trades"
echo "  ./scripts/trade-review.sh 12      # Last 12 hours"
echo "  npx pm2 monit                     # Interactive monitoring"

echo ""
echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"
echo ""

