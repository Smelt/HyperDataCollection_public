/**
 * Trade Size Repository
 *
 * Handles storage and retrieval of trade sizes for position sizing analysis.
 * Table is partitioned by day with 7-day auto-retention.
 */

import { Pool, RowDataPacket, ResultSetHeader } from 'mysql2/promise';

export interface TradeSize {
  id?: number;
  tradeId: number;
  pair: string;
  size: number;
  price: number;
  side: 'B' | 'A';
  timestamp: number;
  buyer?: string;
  seller?: string;
}

export interface TradeSizeStats {
  pair: string;
  hours: number;
  sampleCount: number;
  avgSize: number;
  minSize: number;
  maxSize: number;
  avgNotionalUsd: number;
  percentiles: Record<number, number>; // e.g., { 25: 100, 50: 200, 75: 400 }
}

export class TradeSizeRepository {
  constructor(private pool: Pool) {}

  /**
   * Save a batch of trade sizes (upsert)
   */
  async saveBatch(trades: TradeSize[]): Promise<number> {
    if (trades.length === 0) return 0;

    const values: any[] = [];
    const placeholders: string[] = [];

    for (const trade of trades) {
      placeholders.push('(?, ?, ?, ?, ?, ?, ?, ?)');
      values.push(
        trade.tradeId,
        trade.pair,
        trade.size,
        trade.price,
        trade.side,
        trade.timestamp,
        trade.buyer || null,
        trade.seller || null
      );
    }

    const sql = `
      INSERT INTO trade_sizes (trade_id, pair, size, price, side, timestamp, buyer, seller)
      VALUES ${placeholders.join(', ')}
      ON DUPLICATE KEY UPDATE
        size = VALUES(size),
        price = VALUES(price),
        buyer = VALUES(buyer),
        seller = VALUES(seller)
    `;

    try {
      const [result] = await this.pool.execute<ResultSetHeader>(sql, values);
      return result.affectedRows;
    } catch (error) {
      console.error('Error saving trade sizes:', error);
      throw error;
    }
  }

  /**
   * Get trade size statistics with customizable percentiles
   *
   * @param pair Trading pair
   * @param hours Time window in hours
   * @param percentiles Array of percentiles to calculate (e.g., [25, 50, 75])
   */
  async getStats(
    pair: string,
    hours: number = 1,
    percentiles: number[] = [25, 50, 75]
  ): Promise<TradeSizeStats | null> {
    const cutoffTime = Date.now() - hours * 60 * 60 * 1000;

    // First get basic stats
    const [basicRows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT
        COUNT(*) as sample_count,
        AVG(size) as avg_size,
        MIN(size) as min_size,
        MAX(size) as max_size,
        AVG(notional_usd) as avg_notional_usd
      FROM trade_sizes
      WHERE pair = ? AND timestamp >= ?`,
      [pair.toUpperCase(), cutoffTime]
    );

    if (basicRows.length === 0 || basicRows[0].sample_count === 0) {
      return null;
    }

    const stats = basicRows[0];

    // Calculate percentiles using PERCENT_RANK
    const percentileResults: Record<number, number> = {};

    for (const p of percentiles) {
      const pctRank = p / 100;

      const [pctRows] = await this.pool.execute<RowDataPacket[]>(
        `WITH ranked AS (
          SELECT size, PERCENT_RANK() OVER (ORDER BY size) as pct_rank
          FROM trade_sizes
          WHERE pair = ? AND timestamp >= ?
        )
        SELECT MIN(size) as percentile_value
        FROM ranked
        WHERE pct_rank >= ?`,
        [pair.toUpperCase(), cutoffTime, pctRank]
      );

      if (pctRows.length > 0 && pctRows[0].percentile_value !== null) {
        percentileResults[p] = parseFloat(pctRows[0].percentile_value);
      }
    }

    return {
      pair: pair.toUpperCase(),
      hours,
      sampleCount: stats.sample_count,
      avgSize: parseFloat(stats.avg_size),
      minSize: parseFloat(stats.min_size),
      maxSize: parseFloat(stats.max_size),
      avgNotionalUsd: parseFloat(stats.avg_notional_usd || 0),
      percentiles: percentileResults,
    };
  }

  /**
   * Get all percentile stats in a single optimized query
   */
  async getStatsOptimized(
    pair: string,
    hours: number = 1,
    percentiles: number[] = [25, 50, 75]
  ): Promise<TradeSizeStats | null> {
    const cutoffTime = Date.now() - hours * 60 * 60 * 1000;

    // Build dynamic percentile selection
    const percentileCases = percentiles
      .map(
        (p) =>
          `MIN(CASE WHEN pct_rank >= ${p / 100} THEN size END) as p${p}`
      )
      .join(',\n        ');

    const sql = `
      WITH ranked AS (
        SELECT
          size,
          notional_usd,
          PERCENT_RANK() OVER (ORDER BY size) as pct_rank
        FROM trade_sizes
        WHERE pair = ? AND timestamp >= ?
      )
      SELECT
        COUNT(*) as sample_count,
        AVG(size) as avg_size,
        MIN(size) as min_size,
        MAX(size) as max_size,
        AVG(notional_usd) as avg_notional_usd,
        ${percentileCases}
      FROM ranked
    `;

    try {
      const [rows] = await this.pool.execute<RowDataPacket[]>(sql, [
        pair.toUpperCase(),
        cutoffTime,
      ]);

      if (rows.length === 0 || rows[0].sample_count === 0) {
        return null;
      }

      const stats = rows[0];
      const percentileResults: Record<number, number> = {};

      for (const p of percentiles) {
        const key = `p${p}`;
        if (stats[key] !== null) {
          percentileResults[p] = parseFloat(stats[key]);
        }
      }

      return {
        pair: pair.toUpperCase(),
        hours,
        sampleCount: stats.sample_count,
        avgSize: parseFloat(stats.avg_size),
        minSize: parseFloat(stats.min_size),
        maxSize: parseFloat(stats.max_size),
        avgNotionalUsd: parseFloat(stats.avg_notional_usd || 0),
        percentiles: percentileResults,
      };
    } catch (error) {
      console.error('Error getting trade size stats:', error);
      throw error;
    }
  }

  /**
   * Get latest trade ID for a pair (to avoid re-fetching)
   */
  async getLatestTradeId(pair: string): Promise<number | null> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT MAX(trade_id) as latest_id
       FROM trade_sizes
       WHERE pair = ?`,
      [pair.toUpperCase()]
    );

    return rows.length > 0 ? rows[0].latest_id : null;
  }

  /**
   * Get pairs with trade data
   */
  async getActivePairs(sinceHours: number = 1): Promise<string[]> {
    const cutoffTime = Date.now() - sinceHours * 60 * 60 * 1000;

    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT DISTINCT pair
       FROM trade_sizes
       WHERE timestamp >= ?
       ORDER BY pair`,
      [cutoffTime]
    );

    return rows.map((r) => r.pair);
  }

  /**
   * Get count of trades per pair
   */
  async getTradeCountByPair(hours: number = 24): Promise<Map<string, number>> {
    const cutoffTime = Date.now() - hours * 60 * 60 * 1000;

    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT pair, COUNT(*) as count
       FROM trade_sizes
       WHERE timestamp >= ?
       GROUP BY pair`,
      [cutoffTime]
    );

    const counts = new Map<string, number>();
    for (const row of rows) {
      counts.set(row.pair, row.count);
    }
    return counts;
  }

  /**
   * Get recent trades for a pair (for position sizing)
   * Returns trades sorted by timestamp descending (newest first)
   */
  async getRecentTrades(
    pair: string,
    limit: number = 100,
    hours: number = 24
  ): Promise<TradeSize[]> {
    const cutoffTime = Date.now() - hours * 60 * 60 * 1000;
    const safeLimit = Math.max(1, Math.min(500, Math.floor(limit))); // Ensure limit is a safe integer

    // Use query() instead of execute() for LIMIT clause compatibility
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT trade_id, pair, size, price, side, timestamp
       FROM trade_sizes
       WHERE pair = ? AND timestamp >= ?
       ORDER BY timestamp DESC
       LIMIT ${safeLimit}`,
      [pair.toUpperCase(), cutoffTime]
    );

    return rows.map((row) => ({
      tradeId: row.trade_id,
      pair: row.pair,
      size: parseFloat(row.size),
      price: parseFloat(row.price),
      side: row.side as 'B' | 'A',
      timestamp: row.timestamp,
    }));
  }
}
