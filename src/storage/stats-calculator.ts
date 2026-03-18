import { SnapshotRepository } from './snapshot-repo.js';
import { StatsRepository } from './stats-repo.js';
import { HourlyStats } from '../types/index.js';

/**
 * Statistics calculator service
 * Aggregates snapshot data into hourly statistics
 */
export class StatsCalculator {
  private snapshotRepo: SnapshotRepository;
  private statsRepo: StatsRepository;
  private calculationInterval: number;
  private timer: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;
  private pairs: string[];

  constructor(
    pairs: string[],
    calculationIntervalMs: number = 60 * 60 * 1000 // 1 hour default
  ) {
    this.snapshotRepo = new SnapshotRepository();
    this.statsRepo = new StatsRepository();
    this.pairs = pairs;
    this.calculationInterval = calculationIntervalMs;
  }

  /**
   * Start periodic stats calculation
   */
  start(): void {
    if (this.isRunning) {
      console.log('Stats calculator already running');
      return;
    }

    this.isRunning = true;
    console.log(
      `Starting stats calculator (interval: ${this.calculationInterval / 1000}s)`
    );

    // Calculate immediately on start
    this.calculateStats().catch((error) => {
      console.error('Error calculating stats on start:', error);
    });

    // Then run periodically
    this.timer = setInterval(() => {
      this.calculateStats().catch((error) => {
        console.error('Error calculating stats:', error);
      });
    }, this.calculationInterval);
  }

  /**
   * Stop stats calculation
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.isRunning = false;
    console.log('Stats calculator stopped');
  }

  /**
   * Calculate hourly statistics for all pairs
   */
  async calculateStats(): Promise<void> {
    const now = Date.now();
    const hourStart = this.getHourStart(now);

    console.log(
      `Calculating hourly stats for ${this.pairs.length} pairs...`
    );

    let calculated = 0;
    let errors = 0;

    for (const pair of this.pairs) {
      try {
        const stats = await this.calculateHourlyStats(
          pair,
          hourStart
        );
        if (stats) {
          await this.statsRepo.saveHourlyStats(stats);
          calculated++;
        }
      } catch (error) {
        errors++;
        console.error(
          `Error calculating stats for ${pair}:`,
          error
        );
      }
    }

    console.log(
      `Stats calculation complete: ${calculated} pairs calculated, ${errors} errors`
    );
  }

  /**
   * Calculate hourly statistics for a specific pair
   */
  async calculateHourlyStats(
    pair: string,
    hourTimestamp: number
  ): Promise<HourlyStats | null> {
    const hourEnd = hourTimestamp + 60 * 60 * 1000;

    // Get all snapshots for this hour
    const snapshots =
      await this.snapshotRepo.getSnapshotsByTimeRange(
        pair,
        hourTimestamp,
        hourEnd
      );

    if (snapshots.length === 0) {
      return null;
    }

    // Calculate statistics
    const spreads = snapshots.map((s) => s.spreadPct);
    const volumes = snapshots.map((s) => s.bidSize + s.askSize);

    const stats: HourlyStats = {
      hourTimestamp,
      pair,
      avgSpread: this.average(spreads),
      minSpread: Math.min(...spreads),
      maxSpread: Math.max(...spreads),
      stdDev: this.standardDeviation(spreads),
      medianSpread: this.median(spreads),
      sampleCount: snapshots.length,
      avgVolume: this.average(volumes),
    };

    return stats;
  }

  /**
   * Get the start of the current hour
   */
  private getHourStart(timestamp: number): number {
    const date = new Date(timestamp);
    date.setMinutes(0, 0, 0);
    return date.getTime();
  }

  /**
   * Calculate average of an array of numbers
   */
  private average(numbers: number[]): number {
    if (numbers.length === 0) return 0;
    const sum = numbers.reduce((a, b) => a + b, 0);
    return sum / numbers.length;
  }

  /**
   * Calculate median of an array of numbers
   */
  private median(numbers: number[]): number {
    if (numbers.length === 0) return 0;

    const sorted = [...numbers].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);

    if (sorted.length % 2 === 0) {
      return (sorted[mid - 1] + sorted[mid]) / 2;
    } else {
      return sorted[mid];
    }
  }

  /**
   * Calculate standard deviation
   */
  private standardDeviation(numbers: number[]): number {
    if (numbers.length === 0) return 0;

    const avg = this.average(numbers);
    const squareDiffs = numbers.map((value) => {
      const diff = value - avg;
      return diff * diff;
    });

    const avgSquareDiff = this.average(squareDiffs);
    return Math.sqrt(avgSquareDiff);
  }

  /**
   * Calculate stats for previous hour (useful for backfilling)
   */
  async calculatePreviousHour(): Promise<void> {
    const now = Date.now();
    const previousHourStart = this.getHourStart(now) - 60 * 60 * 1000;

    console.log(
      `Calculating stats for previous hour: ${new Date(previousHourStart).toISOString()}`
    );

    let calculated = 0;
    for (const pair of this.pairs) {
      try {
        const stats = await this.calculateHourlyStats(
          pair,
          previousHourStart
        );
        if (stats) {
          await this.statsRepo.saveHourlyStats(stats);
          calculated++;
        }
      } catch (error) {
        console.error(
          `Error calculating previous hour stats for ${pair}:`,
          error
        );
      }
    }

    console.log(
      `Previous hour stats complete: ${calculated} pairs calculated`
    );
  }

  /**
   * Backfill stats for a time range
   */
  async backfillStats(
    startTime: number,
    endTime: number
  ): Promise<void> {
    console.log(
      `Backfilling stats from ${new Date(startTime).toISOString()} to ${new Date(endTime).toISOString()}`
    );

    const hourInMs = 60 * 60 * 1000;
    let currentHour = this.getHourStart(startTime);
    let totalCalculated = 0;

    while (currentHour < endTime) {
      console.log(
        `Backfilling hour: ${new Date(currentHour).toISOString()}`
      );

      for (const pair of this.pairs) {
        try {
          const stats = await this.calculateHourlyStats(
            pair,
            currentHour
          );
          if (stats) {
            await this.statsRepo.saveHourlyStats(stats);
            totalCalculated++;
          }
        } catch (error) {
          console.error(
            `Error backfilling stats for ${pair} at ${currentHour}:`,
            error
          );
        }
      }

      currentHour += hourInMs;
    }

    console.log(`Backfill complete: ${totalCalculated} stats calculated`);
  }
}
