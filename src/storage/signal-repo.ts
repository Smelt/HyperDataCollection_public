import { getPool } from './database.js';
import { TradingSignal } from '../types/index.js';
import { RowDataPacket } from 'mysql2/promise';

export class SignalRepository {
  /**
   * Save a trading signal to the database
   */
  async saveSignal(signal: TradingSignal): Promise<void> {
    const start = Date.now();

    try {
      const pool = getPool();

      await pool.execute(
        `INSERT INTO trading_signals
         (timestamp, pair, signal_type, current_spread, avg_spread_1h,
          avg_spread_24h, threshold, confidence, expected_profit, reasoning)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          signal.timestamp,
          signal.pair,
          signal.signalType,
          signal.currentSpread,
          signal.avgSpread1h,
          signal.avgSpread24h || null,
          signal.threshold || null,
          signal.confidence || null,
          signal.expectedProfit || null,
          signal.reasoning || null,
        ]
      );

      const duration = Date.now() - start;
      if (duration > 1000) {
        console.warn(
          `Slow signal save: ${signal.pair} took ${duration}ms`
        );
      }
    } catch (error) {
      console.error(
        `Failed to save signal for ${signal.pair}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Get recent signals for a specific pair
   */
  async getRecentSignals(
    pair: string,
    limit: number = 100
  ): Promise<TradingSignal[]> {
    const start = Date.now();

    try {
      const pool = getPool();

      const [rows] = await pool.execute<RowDataPacket[]>(
        `SELECT * FROM trading_signals
         WHERE pair = ?
         ORDER BY timestamp DESC
         LIMIT ?`,
        [pair, limit]
      );

      const duration = Date.now() - start;
      if (duration > 1000) {
        console.warn(
          `Slow query: getRecentSignals for ${pair} took ${duration}ms`
        );
      }

      return rows.map((row) => ({
        id: row.id,
        timestamp: row.timestamp,
        pair: row.pair,
        signalType: row.signal_type,
        currentSpread: parseFloat(row.current_spread),
        avgSpread1h: parseFloat(row.avg_spread_1h),
        avgSpread24h: row.avg_spread_24h
          ? parseFloat(row.avg_spread_24h)
          : undefined,
        threshold: row.threshold
          ? parseFloat(row.threshold)
          : undefined,
        confidence: row.confidence
          ? parseFloat(row.confidence)
          : undefined,
        expectedProfit: row.expected_profit
          ? parseFloat(row.expected_profit)
          : undefined,
        reasoning: row.reasoning || undefined,
      }));
    } catch (error) {
      console.error(
        `Failed to get recent signals for ${pair}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Get signals by type for a specific pair
   */
  async getSignalsByType(
    pair: string,
    signalType: 'ENTER' | 'EXIT' | 'HOLD',
    limit: number = 50
  ): Promise<TradingSignal[]> {
    const start = Date.now();

    try {
      const pool = getPool();

      const [rows] = await pool.execute<RowDataPacket[]>(
        `SELECT * FROM trading_signals
         WHERE pair = ? AND signal_type = ?
         ORDER BY timestamp DESC
         LIMIT ?`,
        [pair, signalType, limit]
      );

      const duration = Date.now() - start;
      if (duration > 1000) {
        console.warn(
          `Slow query: getSignalsByType for ${pair} took ${duration}ms`
        );
      }

      return rows.map((row) => ({
        id: row.id,
        timestamp: row.timestamp,
        pair: row.pair,
        signalType: row.signal_type,
        currentSpread: parseFloat(row.current_spread),
        avgSpread1h: parseFloat(row.avg_spread_1h),
        avgSpread24h: row.avg_spread_24h
          ? parseFloat(row.avg_spread_24h)
          : undefined,
        threshold: row.threshold
          ? parseFloat(row.threshold)
          : undefined,
        confidence: row.confidence
          ? parseFloat(row.confidence)
          : undefined,
        expectedProfit: row.expected_profit
          ? parseFloat(row.expected_profit)
          : undefined,
        reasoning: row.reasoning || undefined,
      }));
    } catch (error) {
      console.error(
        `Failed to get signals by type for ${pair}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Get all signals within a time range
   */
  async getSignalsByTimeRange(
    startTime: number,
    endTime: number
  ): Promise<TradingSignal[]> {
    const start = Date.now();

    try {
      const pool = getPool();

      const [rows] = await pool.execute<RowDataPacket[]>(
        `SELECT * FROM trading_signals
         WHERE timestamp >= ? AND timestamp <= ?
         ORDER BY timestamp DESC`,
        [startTime, endTime]
      );

      const duration = Date.now() - start;
      if (duration > 1000) {
        console.warn(
          `Slow query: getSignalsByTimeRange took ${duration}ms`
        );
      }

      return rows.map((row) => ({
        id: row.id,
        timestamp: row.timestamp,
        pair: row.pair,
        signalType: row.signal_type,
        currentSpread: parseFloat(row.current_spread),
        avgSpread1h: parseFloat(row.avg_spread_1h),
        avgSpread24h: row.avg_spread_24h
          ? parseFloat(row.avg_spread_24h)
          : undefined,
        threshold: row.threshold
          ? parseFloat(row.threshold)
          : undefined,
        confidence: row.confidence
          ? parseFloat(row.confidence)
          : undefined,
        expectedProfit: row.expected_profit
          ? parseFloat(row.expected_profit)
          : undefined,
        reasoning: row.reasoning || undefined,
      }));
    } catch (error) {
      console.error(
        'Failed to get signals by time range:',
        error
      );
      throw error;
    }
  }

  /**
   * Delete old signals based on retention policy
   */
  async deleteOldSignals(olderThan: number): Promise<number> {
    const start = Date.now();

    try {
      const pool = getPool();

      const [result] = await pool.execute<any>(
        `DELETE FROM trading_signals WHERE timestamp < ?`,
        [olderThan]
      );

      const duration = Date.now() - start;
      console.log(
        `Deleted ${result.affectedRows} old signals (took ${duration}ms)`
      );

      return result.affectedRows;
    } catch (error) {
      console.error('Failed to delete old signals:', error);
      throw error;
    }
  }

  /**
   * Get count of signals
   */
  async getSignalCount(pair?: string): Promise<number> {
    try {
      const pool = getPool();

      let query =
        'SELECT COUNT(*) as count FROM trading_signals';
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
      console.error('Failed to get signal count:', error);
      throw error;
    }
  }

  /**
   * Get latest signal for a pair
   */
  async getLatestSignal(
    pair: string
  ): Promise<TradingSignal | null> {
    try {
      const pool = getPool();

      const [rows] = await pool.execute<RowDataPacket[]>(
        `SELECT * FROM trading_signals
         WHERE pair = ?
         ORDER BY timestamp DESC
         LIMIT 1`,
        [pair]
      );

      if (rows.length === 0) return null;

      const row = rows[0];
      return {
        id: row.id,
        timestamp: row.timestamp,
        pair: row.pair,
        signalType: row.signal_type,
        currentSpread: parseFloat(row.current_spread),
        avgSpread1h: parseFloat(row.avg_spread_1h),
        avgSpread24h: row.avg_spread_24h
          ? parseFloat(row.avg_spread_24h)
          : undefined,
        threshold: row.threshold
          ? parseFloat(row.threshold)
          : undefined,
        confidence: row.confidence
          ? parseFloat(row.confidence)
          : undefined,
        expectedProfit: row.expected_profit
          ? parseFloat(row.expected_profit)
          : undefined,
        reasoning: row.reasoning || undefined,
      };
    } catch (error) {
      console.error(
        `Failed to get latest signal for ${pair}:`,
        error
      );
      throw error;
    }
  }
}
