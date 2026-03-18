#!/bin/bash
# scripts/fix-grafana-time-filters.sh
# Update Grafana dashboards to use dynamic time filters instead of hardcoded intervals

set -e

GRAFANA_DIR="/Users/shivamsatyarthi/Projects/HyperDataCollection/grafana"
BACKUP_DIR="${GRAFANA_DIR}/backup-$(date +%Y%m%d-%H%M%S)"

echo "========================================="
echo "  Fix Grafana Time Filters"
echo "========================================="
echo ""

# Create backup
echo "Creating backup..."
mkdir -p "${BACKUP_DIR}"
cp "${GRAFANA_DIR}"/*.json "${BACKUP_DIR}/" 2>/dev/null || true
echo "✓ Backup created at: ${BACKUP_DIR}"
echo ""

# Counter for changes
TOTAL_CHANGES=0

# Function to update a single dashboard
update_dashboard() {
  local file="$1"
  local basename=$(basename "$file")
  echo "Processing: ${basename}"

  # Create temporary file
  local temp_file="${file}.tmp"

  # Patterns to replace:
  # 1. WHERE timestamp > (UNIX_TIMESTAMP(NOW()) - XXXX) * 1000
  #    Replace with: WHERE timestamp >= \$__timeFrom() AND timestamp <= \$__timeTo()

  # 2. WHERE timestamp > UNIX_TIMESTAMP(NOW() - INTERVAL X MINUTE) * 1000
  #    Replace with: WHERE timestamp >= \$__timeFrom() AND timestamp <= \$__timeTo()

  # Use sed to replace patterns
  sed -E '
    # Pattern 1: timestamp > (UNIX_TIMESTAMP(NOW()) - NUMBER) * 1000
    s/timestamp > \(UNIX_TIMESTAMP\(NOW\(\)\) - [0-9]+\) \* 1000/timestamp >= \$__timeFrom() AND timestamp <= \$__timeTo()/g

    # Pattern 2: timestamp > UNIX_TIMESTAMP(NOW() - INTERVAL [NUMBER] [UNIT]) * 1000
    s/timestamp > UNIX_TIMESTAMP\(NOW\(\) - INTERVAL [0-9]+ (MINUTE|HOUR|DAY|SECOND)\) \* 1000/timestamp >= \$__timeFrom() AND timestamp <= \$__timeTo()/g

    # Pattern 3: timestamp >= (UNIX_TIMESTAMP(NOW()) - NUMBER) * 1000
    s/timestamp >= \(UNIX_TIMESTAMP\(NOW\(\)\) - [0-9]+\) \* 1000/timestamp >= \$__timeFrom() AND timestamp <= \$__timeTo()/g

    # Pattern 4: s.timestamp > (UNIX_TIMESTAMP(NOW()) - NUMBER) * 1000
    s/s\.timestamp > \(UNIX_TIMESTAMP\(NOW\(\)\) - [0-9]+\) \* 1000/s.timestamp >= \$__timeFrom() AND s.timestamp <= \$__timeTo()/g
  ' "$file" > "$temp_file"

  # Check if changes were made
  if ! cmp -s "$file" "$temp_file"; then
    mv "$temp_file" "$file"
    echo "  ✓ Updated"
    TOTAL_CHANGES=$((TOTAL_CHANGES + 1))
  else
    rm "$temp_file"
    echo "  - No changes needed"
  fi
}

# Update all dashboard files
for dashboard in "${GRAFANA_DIR}"/*.json; do
  if [ -f "$dashboard" ]; then
    update_dashboard "$dashboard"
  fi
done

echo ""
echo "========================================="
echo "Summary:"
echo "  Files processed: $(ls -1 ${GRAFANA_DIR}/*.json 2>/dev/null | wc -l)"
echo "  Files updated: ${TOTAL_CHANGES}"
echo "  Backup location: ${BACKUP_DIR}"
echo "========================================="
echo ""
echo "Next steps:"
echo "  1. Review changes: git diff grafana/"
echo "  2. Test in Grafana"
echo "  3. If satisfied, deploy to EC2"
echo ""
