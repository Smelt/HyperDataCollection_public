import { getPool } from './database.js';
import { HourlyStats } from '../types/index.js';
import { RowDataPacket } from 'mysql2/promise';

export class StatsRepository {
  /**
   * Save hourly statistics (upsert operation)
   */
  async saveHourlyStats(stats: HourlyStats): Promise<void> {
    const start = Date.now();

    try {
      const pool = getPool();

      await pool.execute(
        `INSERT INTO spread_stats_hourly
         (hour_timestamp, pair, avg_spread, min_spread, max_spread,
          std_dev, median_spread, sample_count, avg_volume)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           avg_spread = VALUES(avg_spread),
           min_spread = VALUES(min_spread),
           max_spread = VALUES(max_spread),
           std_dev = VALUES(std_dev),
           median_spread = VALUES(median_spread),
           sample_count = VALUES(sample_count),
           avg_volume = VALUES(avg_volume)`,
        [
          stats.hourTimestamp,
          stats.pair,
          stats.avgSpread,
          stats.minSpread,
          stats.maxSpread,
          stats.stdDev,
          stats.medianSpread,
          stats.sampleCount,
          stats.avgVolume,
        ]
      );

      const duration = Date.now() - start;
      if (duration > 1000) {
        console.warn(
          `Slow stats save: ${stats.pair} took ${duration}ms`
        );
      }
    } catch (error) {
      console.error(
        `Failed to save hourly stats for ${stats.pair}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Get hourly statistics for a pair looking back N hours
   */
  async getHourlyStats(
    pair: string,
    hoursBack: number
  ): Promise<HourlyStats[]> {
    const start = Date.now();

    try {
      const pool = getPool();
      const cutoff =
        Date.now() - hoursBack * 60 * 60 * 1000;

      const [rows] = await pool.execute<RowDataPacket[]>(
        `SELECT * FROM spread_stats_hourly
         WHERE pair = ? AND hour_timestamp >= ?
         ORDER BY hour_timestamp ASC`,
        [pair, cutoff]
      );

      const duration = Date.now() - start;
      if (duration > 1000) {
        console.warn(
          `Slow query: getHourlyStats for ${pair} took ${duration}ms`
        );
      }

      return rows.map((row) => ({
        id: row.id,
        hourTimestamp: row.hour_timestamp,
        pair: row.pair,
        avgSpread: parseFloat(row.avg_spread),
        minSpread: parseFloat(row.min_spread),
        maxSpread: parseFloat(row.max_spread),
        stdDev: parseFloat(row.std_dev),
        medianSpread: parseFloat(row.median_spread),
        sampleCount: row.sample_count,
        avgVolume: parseFloat(row.avg_volume),
      }));
    } catch (error) {
      console.error(
        `Failed to get hourly stats for ${pair}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Get all available pairs with statistics
   */
  async getAllPairsWithStats(): Promise<string[]> {
    try {
      const pool = getPool();

      const [rows] = await pool.execute<RowDataPacket[]>(
        `SELECT DISTINCT pair FROM spread_stats_hourly
         ORDER BY pair ASC`
      );

      return rows.map((row) => row.pair);
    } catch (error) {
      console.error('Failed to get pairs with stats:', error);
      throw error;
    }
  }

  /**
   * Get latest hourly stats for all pairs
   */
  async getLatestStatsForAllPairs(): Promise<
    Map<string, HourlyStats>
  > {
    const start = Date.now();

    try {
      const pool = getPool();

      // Get the most recent stats for each pair
      const [rows] = await pool.execute<RowDataPacket[]>(
        `SELECT s1.*
         FROM spread_stats_hourly s1
         INNER JOIN (
           SELECT pair, MAX(hour_timestamp) as max_timestamp
           FROM spread_stats_hourly
           GROUP BY pair
         ) s2 ON s1.pair = s2.pair AND s1.hour_timestamp = s2.max_timestamp
         ORDER BY s1.pair ASC`
      );

      const duration = Date.now() - start;
      if (duration > 1000) {
        console.warn(
          `Slow query: getLatestStatsForAllPairs took ${duration}ms`
        );
      }

      const statsMap = new Map<string, HourlyStats>();

      rows.forEach((row) => {
        statsMap.set(row.pair, {
          id: row.id,
          hourTimestamp: row.hour_timestamp,
          pair: row.pair,
          avgSpread: parseFloat(row.avg_spread),
          minSpread: parseFloat(row.min_spread),
          maxSpread: parseFloat(row.max_spread),
          stdDev: parseFloat(row.std_dev),
          medianSpread: parseFloat(row.median_spread),
          sampleCount: row.sample_count,
          avgVolume: parseFloat(row.avg_volume),
        });
      });

      return statsMap;
    } catch (error) {
      console.error(
        'Failed to get latest stats for all pairs:',
        error
      );
      throw error;
    }
  }

  /**
   * Get average spread for a pair over last N hours
   */
  async getAverageSpread(
    pair: string,
    hoursBack: number
  ): Promise<number | null> {
    try {
      const pool = getPool();
      const cutoff =
        Date.now() - hoursBack * 60 * 60 * 1000;

      const [rows] = await pool.execute<RowDataPacket[]>(
        `SELECT AVG(avg_spread) as avg
         FROM spread_stats_hourly
         WHERE pair = ? AND hour_timestamp >= ?`,
        [pair, cutoff]
      );

      return rows[0].avg ? parseFloat(rows[0].avg) : null;
    } catch (error) {
      console.error(
        `Failed to get average spread for ${pair}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Get hourly stats count for a pair
   */
  async getStatsCount(pair?: string): Promise<number> {
    try {
      const pool = getPool();

      let query =
        'SELECT COUNT(*) as count FROM spread_stats_hourly';
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
      console.error('Failed to get stats count:', error);
      throw error;
    }
  }
}
