import { SpreadData, SpreadSnapshot } from '../types/index.js';
import { SnapshotRepository } from './snapshot-repo.js';

/**
 * Database logger service for spread data
 * Handles batching and error recovery
 */
export class DatabaseLogger {
  private repository: SnapshotRepository;
  private batchBuffer: SpreadSnapshot[] = [];
  private batchSize: number;
  private batchTimeout: number;
  private batchTimer: NodeJS.Timeout | null = null;
  private isEnabled: boolean;
  private totalSaved: number = 0;
  private totalErrors: number = 0;

  constructor(
    batchSize: number = 100,
    batchTimeout: number = 5000,
    enabled: boolean = true
  ) {
    this.repository = new SnapshotRepository();
    this.batchSize = batchSize;
    this.batchTimeout = batchTimeout;
    this.isEnabled = enabled;
  }

  /**
   * Log spread data to database
   * Uses batching for efficiency
   */
  async logSpread(data: SpreadData): Promise<void> {
    if (!this.isEnabled) return;

    const snapshot: SpreadSnapshot = {
      timestamp: data.timestamp,
      pair: data.pair,
      bestBid: data.bestBid,
      bestAsk: data.bestAsk,
      spreadPct: data.spreadPct,
      spreadBps: data.spreadBps,
      bidSize: data.bidSize,
      askSize: data.askSize,
      midPrice: data.midPrice,
      imbalance: data.imbalance,
    };

    this.batchBuffer.push(snapshot);

    // Flush if batch is full
    if (this.batchBuffer.length >= this.batchSize) {
      await this.flush();
    } else {
      // Reset timeout
      this.resetBatchTimer();
    }
  }

  /**
   * Flush all pending snapshots to database
   */
  async flush(): Promise<void> {
    if (this.batchBuffer.length === 0) return;

    // Clear timeout
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }

    const snapshots = [...this.batchBuffer];
    this.batchBuffer = [];

    try {
      await this.repository.saveBatch(snapshots);
      this.totalSaved += snapshots.length;

      if (this.totalSaved % 1000 === 0) {
        console.log(
          `Database logger: ${this.totalSaved} snapshots saved (${this.totalErrors} errors)`
        );
      }
    } catch (error) {
      this.totalErrors++;
      console.error(
        `Failed to save batch of ${snapshots.length} snapshots:`,
        error
      );

      // Re-add to buffer for retry (prevent data loss)
      this.batchBuffer.push(...snapshots);

      // If buffer gets too large, drop oldest data to prevent memory issues
      if (this.batchBuffer.length > this.batchSize * 10) {
        const dropped = this.batchBuffer.splice(
          0,
          this.batchBuffer.length - this.batchSize
        );
        console.warn(
          `Database logger: Dropped ${dropped.length} old snapshots to prevent memory overflow`
        );
      }
    }
  }

  /**
   * Reset batch timer
   */
  private resetBatchTimer(): void {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
    }

    this.batchTimer = setTimeout(() => {
      this.flush().catch((error) => {
        console.error('Error flushing batch on timeout:', error);
      });
    }, this.batchTimeout);
  }

  /**
   * Get statistics about database logging
   */
  getStats(): {
    totalSaved: number;
    totalErrors: number;
    bufferSize: number;
  } {
    return {
      totalSaved: this.totalSaved,
      totalErrors: this.totalErrors,
      bufferSize: this.batchBuffer.length,
    };
  }

  /**
   * Enable or disable database logging
   */
  setEnabled(enabled: boolean): void {
    this.isEnabled = enabled;
    if (!enabled) {
      // Flush remaining data before disabling
      this.flush().catch((error) => {
        console.error('Error flushing on disable:', error);
      });
    }
  }

  /**
   * Shutdown the logger (flush and cleanup)
   */
  async shutdown(): Promise<void> {
    console.log('Shutting down database logger...');
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
    await this.flush();
    console.log(
      `Database logger shutdown complete. Total saved: ${this.totalSaved}, errors: ${this.totalErrors}`
    );
  }
}
