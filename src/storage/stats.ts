import { SpreadData, SpreadStats, MarketMakingOpportunity } from '../types/index.js';
import * as fs from 'fs';
import * as path from 'path';
import { format } from 'date-fns';

export class StatisticsCalculator {
  private dataByPair: Map<string, SpreadData[]> = new Map();
  private maxDataPoints = 10000; // Keep last 10k points per pair
  private dataDir: string;
  private enableJsonSummary: boolean;

  constructor(dataDir: string, enableJsonSummary: boolean = true) {
    this.dataDir = dataDir;
    this.enableJsonSummary = enableJsonSummary;
  }

  /**
   * Add new spread data point
   */
  addDataPoint(data: SpreadData): void {
    if (!this.dataByPair.has(data.pair)) {
      this.dataByPair.set(data.pair, []);
    }

    const pairData = this.dataByPair.get(data.pair)!;
    pairData.push(data);

    // Keep only the most recent data points
    if (pairData.length > this.maxDataPoints) {
      pairData.shift();
    }
  }

  /**
   * Calculate statistics for a specific pair
   */
  calculateStats(pair: string): SpreadStats | null {
    const data = this.dataByPair.get(pair);
    if (!data || data.length === 0) {
      return null;
    }

    const spreads = data.map(d => d.spreadPct);
    const now = Date.now();

    // Calculate overall stats
    const avgSpread = this.mean(spreads);
    const minSpread = Math.min(...spreads);
    const maxSpread = Math.max(...spreads);
    const stdDev = this.standardDeviation(spreads);

    // Calculate time-window averages
    const avgSpread5m = this.calculateWindowAverage(data, now, 5 * 60 * 1000);
    const avgSpread1h = this.calculateWindowAverage(data, now, 60 * 60 * 1000);

    return {
      pair,
      count: data.length,
      avgSpread,
      minSpread,
      maxSpread,
      stdDev,
      avgSpread5m,
      avgSpread1h,
      lastUpdate: now,
    };
  }

  /**
   * Get statistics for all pairs
   */
  getAllStats(): Map<string, SpreadStats> {
    const stats = new Map<string, SpreadStats>();

    for (const pair of this.dataByPair.keys()) {
      const pairStats = this.calculateStats(pair);
      if (pairStats) {
        stats.set(pair, pairStats);
      }
    }

    return stats;
  }

  /**
   * Identify market making opportunities
   */
  identifyOpportunities(makerFeeBps: number): MarketMakingOpportunity[] {
    const opportunities: MarketMakingOpportunity[] = [];

    for (const pair of this.dataByPair.keys()) {
      const stats = this.calculateStats(pair);
      if (!stats) continue;

      const avgSpreadBps = stats.avgSpread * 100;
      const profitability = avgSpreadBps - (makerFeeBps * 2);

      // Only include if profitable
      if (profitability > 0) {
        const consistency = stats.stdDev / stats.avgSpread;

        opportunities.push({
          pair,
          avgSpread: stats.avgSpread,
          avgVolume: 0, // Will be populated separately
          consistency,
          profitability,
          rank: 0, // Will be set after sorting
        });
      }
    }

    // Sort by profitability (descending) and assign ranks
    opportunities.sort((a, b) => b.profitability - a.profitability);
    opportunities.forEach((opp, index) => {
      opp.rank = index + 1;
    });

    return opportunities;
  }

  /**
   * Export summary statistics to JSON
   */
  async exportSummary(): Promise<void> {
    if (!this.enableJsonSummary) {
      return;
    }

    const stats = this.getAllStats();
    const summary = {
      timestamp: new Date().toISOString(),
      pairs: Array.from(stats.entries()).map(([, data]) => ({
        ...data,
      })),
    };

    const today = format(new Date(), 'yyyy-MM-dd');
    const dayDir = path.join(this.dataDir, today);

    if (!fs.existsSync(dayDir)) {
      fs.mkdirSync(dayDir, { recursive: true });
    }

    const filePath = path.join(dayDir, 'summary_stats.json');
    fs.writeFileSync(filePath, JSON.stringify(summary, null, 2));
  }

  /**
   * Calculate average for a time window
   */
  private calculateWindowAverage(
    data: SpreadData[],
    endTime: number,
    windowMs: number
  ): number {
    const startTime = endTime - windowMs;
    const windowData = data.filter(d => d.timestamp >= startTime && d.timestamp <= endTime);

    if (windowData.length === 0) {
      return 0;
    }

    const spreads = windowData.map(d => d.spreadPct);
    return this.mean(spreads);
  }

  /**
   * Calculate mean of an array
   */
  private mean(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((sum, val) => sum + val, 0) / values.length;
  }

  /**
   * Calculate standard deviation
   */
  private standardDeviation(values: number[]): number {
    if (values.length === 0) return 0;

    const avg = this.mean(values);
    const squareDiffs = values.map(value => Math.pow(value - avg, 2));
    const avgSquareDiff = this.mean(squareDiffs);

    return Math.sqrt(avgSquareDiff);
  }

  /**
   * Get total data points collected
   */
  getTotalDataPoints(): number {
    let total = 0;
    for (const data of this.dataByPair.values()) {
      total += data.length;
    }
    return total;
  }

  /**
   * Clear all data
   */
  clear(): void {
    this.dataByPair.clear();
  }
}
