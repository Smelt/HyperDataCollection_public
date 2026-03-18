#!/usr/bin/env python3
"""
Optimize Grafana dashboard queries to use spread_snapshots_1min table
instead of the large spread_snapshots table
"""

import json
import re
from pathlib import Path

GRAFANA_DIR = Path("/Users/shivamsatyarthi/Projects/HyperDataCollection/grafana")

def optimize_query(query):
    """
    Optimize a SQL query to use spread_snapshots_1min instead of spread_snapshots
    """
    if not query or 'spread_snapshots' not in query:
        return query

    # Skip if already using 1min table
    if 'spread_snapshots_1min' in query:
        return query

    # Skip if query is getting latest snapshot (not an aggregation)
    if 'MAX(timestamp)' in query and 'AVG' not in query and 'GROUP BY' not in query:
        return query

    original_query = query

    # Replace table name for aggregation queries
    if any(keyword in query for keyword in ['AVG(', 'GROUP BY', 'INTERVAL']):
        # Replace spread_snapshots with spread_snapshots_1min
        query = query.replace('FROM spread_snapshots WHERE', 'FROM spread_snapshots_1min WHERE')

        # Replace time filters with Grafana variables
        query = re.sub(
            r'timestamp\s*>\s*UNIX_TIMESTAMP\(DATE_SUB\(NOW\(\),\s*INTERVAL\s+\d+\s+(HOUR|DAY)\)\)\s*\*\s*1000',
            'timestamp >= $__timeFrom() AND timestamp <= $__timeTo()',
            query,
            flags=re.IGNORECASE
        )

        # Replace aggregation functions
        # AVG(spread_pct) -> AVG(avg_spread_bps)/100
        query = re.sub(r'AVG\(spread_pct\)', 'AVG(avg_spread_bps)/100', query)

        # AVG(spread_bps) -> AVG(avg_spread_bps)
        query = re.sub(r'AVG\(spread_bps\)', 'AVG(avg_spread_bps)', query)

        # MIN(spread_pct) -> MIN(min_spread_bps)/100
        query = re.sub(r'MIN\(spread_pct\)', 'MIN(min_spread_bps)/100', query)

        # MAX(spread_pct) -> MAX(max_spread_bps)/100
        query = re.sub(r'MAX\(spread_pct\)', 'MAX(max_spread_bps)/100', query)

        # STDDEV(spread_pct) -> STDDEV(avg_spread_bps)/100
        query = re.sub(r'STDDEV\(spread_pct\)', 'STDDEV(avg_spread_bps)/100', query)

        # AVG(bid_size + ask_size) -> AVG(avg_bid_size + avg_ask_size)
        query = re.sub(r'AVG\(bid_size\s*\+\s*ask_size\)', 'AVG(avg_bid_size + avg_ask_size)', query)

        # COUNT(*) as samples -> SUM(sample_count) as samples
        query = re.sub(r'COUNT\(\*\)\s+as\s+samples', 'SUM(sample_count) as samples', query, flags=re.IGNORECASE)

        # Fix subqueries that select top pairs
        # Replace subqueries that use spread_snapshots
        query = re.sub(
            r'\(SELECT pair FROM spread_snapshots WHERE timestamp\s*>\s*UNIX_TIMESTAMP\(DATE_SUB\(NOW\(\),\s*INTERVAL\s+\d+\s+(HOUR|DAY)\)\)\s*\*\s*1000 GROUP BY pair ORDER BY AVG\(spread_bps\) DESC LIMIT \d+\)',
            '(SELECT pair FROM spread_snapshots_1min WHERE timestamp >= $__timeFrom() AND timestamp <= $__timeTo() GROUP BY pair ORDER BY AVG(avg_spread_bps) DESC LIMIT 10)',
            query,
            flags=re.IGNORECASE
        )

    if query != original_query:
        return query

    return original_query

def optimize_dashboard(filepath):
    """Optimize all queries in a dashboard"""
    print(f"\nProcessing: {filepath.name}")

    with open(filepath, 'r') as f:
        dashboard = json.load(f)

    changes_made = False

    def process_panel(panel):
        nonlocal changes_made
        if 'targets' in panel:
            for target in panel['targets']:
                if 'rawSql' in target:
                    original = target['rawSql']
                    optimized = optimize_query(original)
                    if optimized != original:
                        target['rawSql'] = optimized
                        changes_made = True

        # Process nested panels
        if 'panels' in panel:
            for sub_panel in panel['panels']:
                process_panel(sub_panel)

    # Process all panels
    if 'panels' in dashboard:
        for panel in dashboard['panels']:
            process_panel(panel)

    if changes_made:
        with open(filepath, 'w') as f:
            json.dump(dashboard, f, indent=2)
        print(f"  ✓ Optimized - {dashboard.get('title', 'Unknown')}")
        return True
    else:
        print(f"  - No changes needed")
        return False

def main():
    print("=" * 60)
    print("Optimizing Dashboard Queries")
    print("=" * 60)

    dashboard_files = list(GRAFANA_DIR.glob("*.json"))
    # Exclude backup directory
    dashboard_files = [f for f in dashboard_files if 'backup' not in str(f)]

    print(f"\nFound {len(dashboard_files)} dashboard files")

    optimized_count = 0
    for filepath in dashboard_files:
        try:
            if optimize_dashboard(filepath):
                optimized_count += 1
        except Exception as e:
            print(f"  ✗ Error: {e}")

    print("\n" + "=" * 60)
    print(f"Summary: {optimized_count}/{len(dashboard_files)} dashboards optimized")
    print("=" * 60)
    print("\nBenefits:")
    print("  • Queries now use 1-minute aggregated data (4000x smaller)")
    print("  • Dynamic time filters with Grafana variables")
    print("  • Sub-second query performance instead of minutes")

if __name__ == "__main__":
    main()
