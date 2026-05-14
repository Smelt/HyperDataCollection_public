/**
 * Candle Repository
 *
 * Stores hourly OHLCV candles per pair. Used to surface realized volume per
 * time bucket in Grafana so we can identify liquid + wide-spread pairs.
 */

import { Pool, ResultSetHeader } from 'mysql2/promise';

export interface PairCandle {
  pair: string;
  timestamp: number; // hour-bucket start, Unix ms
  open: number;
  high: number;
  low: number;
  close: number;
  volumeBase: number;
  volumeUsd: number;
  tradeCount: number;
}

export class CandleRepository {
  constructor(private pool: Pool) {}

  /**
   * Upsert a batch of candles. Last-write-wins on (pair, timestamp).
   */
  async saveBatch(candles: PairCandle[]): Promise<number> {
    if (candles.length === 0) return 0;

    const placeholders: string[] = [];
    const values: any[] = [];
    for (const c of candles) {
      placeholders.push('(?, ?, ?, ?, ?, ?, ?, ?, ?)');
      values.push(
        c.timestamp,
        c.pair,
        c.open,
        c.high,
        c.low,
        c.close,
        c.volumeBase,
        c.volumeUsd,
        c.tradeCount
      );
    }

    const sql = `
      INSERT INTO pair_candles_1h
        (timestamp, pair, open_price, high_price, low_price, close_price,
         volume_base, volume_usd, trade_count)
      VALUES ${placeholders.join(', ')}
      ON DUPLICATE KEY UPDATE
        open_price = VALUES(open_price),
        high_price = VALUES(high_price),
        low_price = VALUES(low_price),
        close_price = VALUES(close_price),
        volume_base = VALUES(volume_base),
        volume_usd = VALUES(volume_usd),
        trade_count = VALUES(trade_count)
    `;

    const [result] = await this.pool.execute<ResultSetHeader>(sql, values);
    return result.affectedRows;
  }
}
