import { getPool } from './database.js';
import { SpreadSnapshot } from '../types/index.js';
import { RowDataPacket } from 'mysql2/promise';

export class SnapshotRepository {
  /**
   * Save a single snapshot to the database
   */
  async saveSnapshot(snapshot: SpreadSnapshot): Promise<void> {
    const start = Date.now();

    try {
      const pool = getPool();

      await pool.execute(
        `INSERT INTO spread_snapshots_partitioned
         (timestamp, pair, best_bid, best_ask, spread_pct, spread_bps,
          bid_size, ask_size, mid_price, imbalance)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          snapshot.timestamp,
          snapshot.pair,
          snapshot.bestBid,
          snapshot.bestAsk,
          snapshot.spreadPct,
          snapshot.spreadBps,
          snapshot.bidSize,
          snapshot.askSize,
          snapshot.midPrice,
          snapshot.imbalance,
        ]
      );

      const duration = Date.now() - start;
      if (duration > 1000) {
        console.warn(
          `Slow snapshot save: ${snapshot.pair} took ${duration}ms`
        );
      }
    } catch (error) {
      console.error(
        `Failed to save snapshot for ${snapshot.pair}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Save multiple snapshots in a single batch operation
   */
  async saveBatch(snapshots: SpreadSnapshot[]): Promise<void> {
    if (snapshots.length === 0) return;

    const start = Date.now();

    try {
      const pool = getPool();
      const values = snapshots.map((s) => [
        s.timestamp,
        s.pair,
        s.bestBid,
        s.bestAsk,
        s.spreadPct,
        s.spreadBps,
        s.bidSize,
        s.askSize,
        s.midPrice,
        s.imbalance,
      ]);

      await pool.query(
        `INSERT INTO spread_snapshots_partitioned
         (timestamp, pair, best_bid, best_ask, spread_pct, spread_bps,
          bid_size, ask_size, mid_price, imbalance)
         VALUES ?`,
        [values]
      );

      const duration = Date.now() - start;
      if (duration > 1000) {
        console.warn(
          `Slow batch save: ${snapshots.length} snapshots took ${duration}ms`
        );
      }
    } catch (error) {
      console.error(
        `Failed to save batch of ${snapshots.length} snapshots:`,
        error
      );
      throw error;
    }
  }

  /**
   * Get recent snapshots for a specific pair since a given timestamp
   */
  async getRecentSnapshots(
    pair: string,
    since: number
  ): Promise<SpreadSnapshot[]> {
    const start = Date.now();

    try {
      const pool = getPool();

      const [rows] = await pool.execute<RowDataPacket[]>(
        `SELECT * FROM spread_snapshots_partitioned
         WHERE pair = ? AND timestamp >= ?
         ORDER BY timestamp ASC`,
        [pair, since]
      );

      const duration = Date.now() - start;
      if (duration > 1000) {
        console.warn(
          `Slow query: getRecentSnapshots for ${pair} took ${duration}ms`
        );
      }

      return rows.map((row) => ({
        id: row.id,
        timestamp: row.timestamp,
        pair: row.pair,
        bestBid: parseFloat(row.best_bid),
        bestAsk: parseFloat(row.best_ask),
        spreadPct: parseFloat(row.spread_pct),
        spreadBps: parseFloat(row.spread_bps),
        bidSize: parseFloat(row.bid_size),
        askSize: parseFloat(row.ask_size),
        midPrice: parseFloat(row.mid_price),
        imbalance: parseFloat(row.imbalance),
      }));
    } catch (error) {
      console.error(
        `Failed to get recent snapshots for ${pair}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Get all snapshots for a specific pair within a time range
   */
  async getSnapshotsByTimeRange(
    pair: string,
    startTime: number,
    endTime: number
  ): Promise<SpreadSnapshot[]> {
    const start = Date.now();

    try {
      const pool = getPool();

      const [rows] = await pool.execute<RowDataPacket[]>(
        `SELECT * FROM spread_snapshots_partitioned
         WHERE pair = ? AND timestamp >= ? AND timestamp <= ?
         ORDER BY timestamp ASC`,
        [pair, startTime, endTime]
      );

      const duration = Date.now() - start;
      if (duration > 1000) {
        console.warn(
          `Slow query: getSnapshotsByTimeRange for ${pair} took ${duration}ms`
        );
      }

      return rows.map((row) => ({
        id: row.id,
        timestamp: row.timestamp,
        pair: row.pair,
        bestBid: parseFloat(row.best_bid),
        bestAsk: parseFloat(row.best_ask),
        spreadPct: parseFloat(row.spread_pct),
        spreadBps: parseFloat(row.spread_bps),
        bidSize: parseFloat(row.bid_size),
        askSize: parseFloat(row.ask_size),
        midPrice: parseFloat(row.mid_price),
        imbalance: parseFloat(row.imbalance),
      }));
    } catch (error) {
      console.error(
        `Failed to get snapshots by time range for ${pair}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Delete old snapshots based on retention policy
   */
  async deleteOldSnapshots(olderThan: number): Promise<number> {
    const start = Date.now();

    try {
      const pool = getPool();

      const [result] = await pool.execute<any>(
        `DELETE FROM spread_snapshots_partitioned WHERE timestamp < ?`,
        [olderThan]
      );

      const duration = Date.now() - start;
      console.log(
        `Deleted ${result.affectedRows} old snapshots (took ${duration}ms)`
      );

      return result.affectedRows;
    } catch (error) {
      console.error('Failed to delete old snapshots:', error);
      throw error;
    }
  }

  /**
   * Get count of snapshots for a pair
   */
  async getSnapshotCount(pair?: string): Promise<number> {
    try {
      const pool = getPool();

      let query = 'SELECT COUNT(*) as count FROM spread_snapshots_partitioned';
      const params: any[] = [];

      if (pair) {
        query += ' WHERE pair = ?';
        params.push(pair);
      }

      const [rows] = await pool.execute<RowDataPacket[]>(
        query,
        params
      );

      return rows[0].count;
    } catch (error) {
      console.error('Failed to get snapshot count:', error);
      throw error;
    }
  }
}
