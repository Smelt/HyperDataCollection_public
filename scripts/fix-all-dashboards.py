#!/usr/bin/env python3
"""
Fix all Grafana dashboards to use dynamic time filters
- Remove custom $timerange variable
- Replace all hardcoded time patterns with $__timeFrom() and $__timeTo()
"""

import json
import os
import re
from pathlib import Path

GRAFANA_DIR = Path("/Users/shivamsatyarthi/Projects/HyperDataCollection/grafana")

def fix_query(query):
    """Replace all time filter patterns with dynamic Grafana variables"""
    if not query:
        return query

    # Pattern 1: timestamp > (UNIX_TIMESTAMP(NOW()) - $timerange) * 1000
    query = re.sub(
        r'timestamp\s*>\s*\(UNIX_TIMESTAMP\(NOW\(\)\)\s*-\s*\$timerange\)\s*\*\s*1000',
        'timestamp >= $__timeFrom() AND timestamp <= $__timeTo()',
        query,
        flags=re.IGNORECASE
    )

    # Pattern 2: timestamp >= (UNIX_TIMESTAMP(NOW()) - NUMBER) * 1000
    query = re.sub(
        r'timestamp\s*>=?\s*\(UNIX_TIMESTAMP\(NOW\(\)\)\s*-\s*\d+\)\s*\*\s*1000',
        'timestamp >= $__timeFrom() AND timestamp <= $__timeTo()',
        query,
        flags=re.IGNORECASE
    )

    # Pattern 3: timestamp > UNIX_TIMESTAMP(NOW() - INTERVAL X UNIT) * 1000
    query = re.sub(
        r'timestamp\s*>\s*UNIX_TIMESTAMP\(NOW\(\)\s*-\s*INTERVAL\s+\d+\s+(SECOND|MINUTE|HOUR|DAY)\)\s*\*\s*1000',
        'timestamp >= $__timeFrom() AND timestamp <= $__timeTo()',
        query,
        flags=re.IGNORECASE
    )

    # Pattern 4: s.timestamp > (UNIX_TIMESTAMP(NOW()) - NUMBER) * 1000
    query = re.sub(
        r's\.timestamp\s*>\s*\(UNIX_TIMESTAMP\(NOW\(\)\)\s*-\s*\d+\)\s*\*\s*1000',
        's.timestamp >= $__timeFrom() AND s.timestamp <= $__timeTo()',
        query,
        flags=re.IGNORECASE
    )

    return query

def remove_timerange_variable(dashboard):
    """Remove the custom $timerange template variable"""
    if 'templating' in dashboard and 'list' in dashboard['templating']:
        dashboard['templating']['list'] = [
            var for var in dashboard['templating']['list']
            if var.get('name') != 'timerange'
        ]
    return dashboard

def fix_panel_queries(panel):
    """Fix all queries in a panel"""
    if 'targets' in panel:
        for target in panel['targets']:
            if 'rawSql' in target:
                target['rawSql'] = fix_query(target['rawSql'])
            if 'query' in target:
                target['query'] = fix_query(target['query'])

    # Recursively fix nested panels
    if 'panels' in panel:
        for sub_panel in panel['panels']:
            fix_panel_queries(sub_panel)

def fix_dashboard(filepath):
    """Fix a single dashboard file"""
    print(f"\nProcessing: {filepath.name}")

    with open(filepath, 'r') as f:
        data = json.load(f)

    # Handle nested dashboard structure
    if 'dashboard' in data:
        dashboard = data['dashboard']
    else:
        dashboard = data

    # Remove custom timerange variable
    dashboard = remove_timerange_variable(dashboard)
    print(f"  ✓ Removed $timerange variable")

    # Fix all panel queries
    if 'panels' in dashboard:
        for panel in dashboard['panels']:
            fix_panel_queries(panel)
        print(f"  ✓ Fixed all query time filters")

    # Write back
    with open(filepath, 'w') as f:
        json.dump(dashboard, f, indent=2)

    print(f"  ✓ Saved: {dashboard.get('title', 'Unknown')}")
    return True

def main():
    print("=" * 60)
    print("Fixing Grafana Dashboards - Dynamic Time Filters")
    print("=" * 60)

    dashboard_files = list(GRAFANA_DIR.glob("*.json"))
    print(f"\nFound {len(dashboard_files)} dashboard files")

    fixed_count = 0
    for filepath in dashboard_files:
        try:
            if fix_dashboard(filepath):
                fixed_count += 1
        except Exception as e:
            print(f"  ✗ Error: {e}")

    print("\n" + "=" * 60)
    print(f"Summary: {fixed_count}/{len(dashboard_files)} dashboards fixed")
    print("=" * 60)
    print("\nNext steps:")
    print("1. Review changes: git diff grafana/")
    print("2. Deploy to EC2: ./scripts/deploy-grafana-to-ec2.sh")

if __name__ == "__main__":
    main()
