import { createObjectCsvWriter } from 'csv-writer';
import { format } from 'date-fns';
import * as fs from 'fs';
import * as path from 'path';
import { SpreadData } from '../types/index.js';

export class CSVLogger {
  private dataDir: string;
  private writers: Map<string, any> = new Map();
  private enabled: boolean;

  constructor(dataDir: string, enabled: boolean = true) {
    this.dataDir = dataDir;
    this.enabled = enabled;

    if (this.enabled) {
      this.ensureDataDirectory();
    }
  }

  /**
   * Log spread data to CSV file
   */
  async log(data: SpreadData): Promise<void> {
    if (!this.enabled) {
      return;
    }

    try {
      const writer = await this.getWriter(data.pair);
      const timestamp = new Date(data.timestamp);

      await writer.writeRecords([
        {
          timestamp: timestamp.toISOString(),
          pair: data.pair,
          best_bid: data.bestBid,
          best_ask: data.bestAsk,
          bid_size: data.bidSize,
          ask_size: data.askSize,
          spread_bps: data.spreadBps.toFixed(2),
          spread_pct: data.spreadPct.toFixed(4),
          mid_price: data.midPrice,
          book_imbalance: data.imbalance.toFixed(4),
        },
      ]);
    } catch (error) {
      console.error(`Error logging to CSV for ${data.pair}:`, error);
    }
  }

  /**
   * Get or create CSV writer for a specific pair
   */
  private async getWriter(pair: string): Promise<any> {
    const today = format(new Date(), 'yyyy-MM-dd');
    const writerKey = `${pair}_${today}`;

    if (this.writers.has(writerKey)) {
      return this.writers.get(writerKey);
    }

    const dayDir = path.join(this.dataDir, today);
    this.ensureDirectory(dayDir);

    const filePath = path.join(dayDir, `${pair}_orderbook.csv`);
    const fileExists = fs.existsSync(filePath);

    const writer = createObjectCsvWriter({
      path: filePath,
      header: [
        { id: 'timestamp', title: 'timestamp' },
        { id: 'pair', title: 'pair' },
        { id: 'best_bid', title: 'best_bid' },
        { id: 'best_ask', title: 'best_ask' },
        { id: 'bid_size', title: 'bid_size' },
        { id: 'ask_size', title: 'ask_size' },
        { id: 'spread_bps', title: 'spread_bps' },
        { id: 'spread_pct', title: 'spread_pct' },
        { id: 'mid_price', title: 'mid_price' },
        { id: 'book_imbalance', title: 'book_imbalance' },
      ],
      append: fileExists,
    });

    this.writers.set(writerKey, writer);
    return writer;
  }

  /**
   * Ensure data directory exists
   */
  private ensureDataDirectory(): void {
    this.ensureDirectory(this.dataDir);
  }

  /**
   * Ensure a directory exists, create if it doesn't
   */
  private ensureDirectory(dir: string): void {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * Clear old writers (call this at the start of each new day)
   */
  clearOldWriters(): void {
    this.writers.clear();
  }

  /**
   * Get the path for today's data
   */
  getTodayPath(): string {
    const today = format(new Date(), 'yyyy-MM-dd');
    return path.join(this.dataDir, today);
  }
}
