import { SpreadStats, MarketMakingOpportunity, SpreadData } from '../types/index.js';
import { format } from 'date-fns';

export class Dashboard {
  private startTime: Date;
  private lastSpreadData: Map<string, SpreadData> = new Map();

  constructor() {
    this.startTime = new Date();
  }

  /**
   * Update last spread data for a pair
   */
  updateSpreadData(data: SpreadData): void {
    this.lastSpreadData.set(data.pair, data);
  }

  /**
   * Render the dashboard
   */
  render(
    stats: Map<string, SpreadStats>,
    opportunities: MarketMakingOpportunity[],
    totalDataPoints: number
  ): void {
    // Clear console
    console.clear();

    // Header
    this.renderHeader(totalDataPoints);

    // Main table
    this.renderMainTable(stats);

    // Top opportunities
    this.renderOpportunities(opportunities);

    // Footer
    this.renderFooter();
  }

  private renderHeader(totalDataPoints: number): void {
    const uptime = this.getUptime();

    console.log('='.repeat(80));
    console.log('         HYPERLIQUID MARKET MAKING MONITOR');
    console.log('='.repeat(80));
    console.log(`Running since: ${format(this.startTime, 'yyyy-MM-dd HH:mm:ss')}`);
    console.log(`Uptime: ${uptime}`);
    console.log(`Data points collected: ${totalDataPoints.toLocaleString()}`);
    console.log('');
  }

  private renderMainTable(stats: Map<string, SpreadStats>): void {
    // Table header
    const headers = [
      'Pair',
      'Current',
      'Avg 5m',
      'Avg 1h',
      'Best Bid',
      'Best Ask',
      'Status'
    ];

    const colWidths = [10, 10, 10, 10, 12, 12, 8];

    console.log(this.formatRow(headers, colWidths));
    console.log('-'.repeat(80));

    // Table rows
    const sortedPairs = Array.from(stats.entries()).sort(
      (a, b) => b[1].avgSpread1h - a[1].avgSpread1h
    );

    for (const [pair, pairStats] of sortedPairs) {
      const lastData = this.lastSpreadData.get(pair);

      const current = lastData
        ? this.formatPercent(lastData.spreadPct)
        : 'N/A';

      const avg5m = pairStats.avgSpread5m > 0
        ? this.formatPercent(pairStats.avgSpread5m)
        : 'N/A';

      const avg1h = pairStats.avgSpread1h > 0
        ? this.formatPercent(pairStats.avgSpread1h)
        : 'N/A';

      const bestBid = lastData
        ? lastData.bestBid.toFixed(6)
        : 'N/A';

      const bestAsk = lastData
        ? lastData.bestAsk.toFixed(6)
        : 'N/A';

      const status = this.getStatusIndicator(pairStats.avgSpread1h);

      const row = [pair, current, avg5m, avg1h, bestBid, bestAsk, status];
      console.log(this.formatRow(row, colWidths));
    }

    console.log('');
  }

  private renderOpportunities(opportunities: MarketMakingOpportunity[]): void {
    console.log('Top Opportunities (by avg spread):');
    console.log('-'.repeat(80));

    const topOpps = opportunities.slice(0, 5);

    if (topOpps.length === 0) {
      console.log('  No profitable opportunities found yet.');
    } else {
      for (const opp of topOpps) {
        const spread = this.formatPercent(opp.avgSpread);
        const profit = `${opp.profitability.toFixed(2)} bps`;
        const consistency = `${(opp.consistency * 100).toFixed(1)}%`;

        console.log(
          `  ${opp.rank}. ${opp.pair.padEnd(8)} - ` +
          `${spread.padEnd(8)} avg, ` +
          `Profit: ${profit.padEnd(10)}, ` +
          `Volatility: ${consistency}`
        );
      }
    }

    console.log('');
  }

  private renderFooter(): void {
    console.log('-'.repeat(80));
    console.log('Status: ✓ Good (>min spread) | ⚠ Tight (<min spread) | ↑ Wide (>1.5x min)');
    console.log('Press Ctrl+C to stop monitoring');
  }

  private formatRow(columns: string[], widths: number[]): string {
    return columns
      .map((col, i) => col.padEnd(widths[i]))
      .join(' | ')
      .trimEnd();
  }

  private formatPercent(value: number): string {
    return `${value.toFixed(3)}%`;
  }

  private getStatusIndicator(spread: number): string {
    if (spread >= 0.1) {
      return '↑ Wide';
    } else if (spread >= 0.05) {
      return '✓ Good';
    } else {
      return '⚠ Tight';
    }
  }

  private getUptime(): string {
    const now = new Date();
    const uptimeMs = now.getTime() - this.startTime.getTime();

    const seconds = Math.floor(uptimeMs / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
      return `${days}d ${hours % 24}h ${minutes % 60}m`;
    } else if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }
}
