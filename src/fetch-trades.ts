/**
 * Trade Fetcher
 *
 * Fetches recent trades from Hyperliquid for all pairs and upserts to database
 * Runs every 5 minutes via cron
 */

import { HttpTransport, InfoClient } from '@nktkas/hyperliquid';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type HttpTransportConfig = any;

dotenv.config();

// Database configuration
const DB_CONFIG = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '3306'),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'Crypto',
};

// Hyperliquid API configuration
const HYPERLIQUID_API_URL = process.env.HYPERLIQUID_API_URL || 'https://api.hyperliquid.xyz';

interface Trade {
  coin: string;
  side: 'B' | 'A';
  px: string;
  sz: string;
  time: number;
  hash: `0x${string}`;
  tid: number;
  users: [`0x${string}`, `0x${string}`];
}

class TradeFetcher {
  private db: mysql.Pool;
  private client: InfoClient;
  private transport: HttpTransport;

  constructor() {
    // Create database connection pool
    this.db = mysql.createPool(DB_CONFIG);

    // Create Hyperliquid transport and client
    this.transport = new HttpTransport({ url: HYPERLIQUID_API_URL } as HttpTransportConfig);
    this.client = new InfoClient({ transport: this.transport });
  }

  /**
   * Get list of all active pairs from database
   */
  async getActivePairs(): Promise<string[]> {
    const [rows] = await this.db.execute<mysql.RowDataPacket[]>(
      `SELECT DISTINCT pair FROM spread_snapshots_partitioned ORDER BY pair`
    );
    return rows.map(row => row.pair);
  }

  /**
   * Fetch recent trades for a single pair
   */
  async fetchTradesForPair(pair: string): Promise<Trade[]> {
    try {
      const trades = await this.client.recentTrades({ coin: pair });
      return trades;
    } catch (error) {
      console.error(`Error fetching trades for ${pair}:`, error);
      return [];
    }
  }

  /**
   * Upsert trades to database
   */
  async upsertTrades(trades: Trade[]): Promise<number> {
    if (trades.length === 0) {
      return 0;
    }

    // Build VALUES clause for batch upsert
    const values: any[] = [];
    const placeholders: string[] = [];

    for (const trade of trades) {
      placeholders.push('(?, ?, ?, ?, ?, ?, ?, ?, ?)');
      values.push(
        trade.tid,
        trade.hash,
        trade.coin,
        trade.side,
        trade.px,
        trade.sz,
        trade.time,
        trade.users[0], // maker
        trade.users[1], // taker
      );
    }

    const sql = `
      INSERT INTO trades (
        trade_id, tx_hash, pair, side, price, size, timestamp, maker_address, taker_address
      ) VALUES ${placeholders.join(', ')}
      ON DUPLICATE KEY UPDATE
        price = VALUES(price),
        size = VALUES(size),
        timestamp = VALUES(timestamp)
    `;

    try {
      const [result] = await this.db.execute<mysql.ResultSetHeader>(sql, values);
      return result.affectedRows;
    } catch (error) {
      console.error('Error upserting trades:', error);
      return 0;
    }
  }

  /**
   * Main execution: Fetch and store trades for all pairs
   */
  async run(): Promise<void> {
    const startTime = Date.now();
    console.log(`========================================`);
    console.log(`Trade Fetcher - ${new Date().toISOString()}`);
    console.log(`========================================\n`);

    try {
      // Get active pairs
      console.log('📋 Fetching active pairs...');
      const pairs = await this.getActivePairs();
      console.log(`   Found ${pairs.length} active pairs\n`);

      // Fetch trades for each pair
      let totalTrades = 0;
      let totalUpserted = 0;
      let successfulPairs = 0;
      let failedPairs = 0;

      for (const pair of pairs) {
        try {
          const trades = await this.fetchTradesForPair(pair);

          if (trades.length > 0) {
            const upserted = await this.upsertTrades(trades);
            totalTrades += trades.length;
            totalUpserted += upserted;
            successfulPairs++;

            console.log(`✓ ${pair.padEnd(10)} ${trades.length.toString().padStart(3)} trades fetched, ${upserted.toString().padStart(3)} upserted`);
          } else {
            console.log(`  ${pair.padEnd(10)} No recent trades`);
          }

          // Small delay to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 50));

        } catch (error) {
          failedPairs++;
          console.error(`✗ ${pair.padEnd(10)} Failed:`, error instanceof Error ? error.message : error);
        }
      }

      // Summary
      const duration = Date.now() - startTime;
      console.log(`\n========================================`);
      console.log(`Summary:`);
      console.log(`  Pairs processed:  ${pairs.length}`);
      console.log(`  Successful:       ${successfulPairs}`);
      console.log(`  Failed:           ${failedPairs}`);
      console.log(`  Total trades:     ${totalTrades}`);
      console.log(`  Upserted:         ${totalUpserted}`);
      console.log(`  Duration:         ${duration}ms`);
      console.log(`========================================\n`);

    } catch (error) {
      console.error('Fatal error:', error);
      throw error;
    } finally {
      // Close database connection
      await this.db.end();
    }
  }
}

// Execute if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const fetcher = new TradeFetcher();
  fetcher.run()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('Unhandled error:', error);
      process.exit(1);
    });
}
