#!/usr/bin/env ts-node
/**
 * Backfill Hyperliquid User Trades
 *
 * Fetches historical user trade fills using the userFillsByTime API endpoint.
 * Can retrieve up to 10,000 most recent trades by fetching in 2000-trade batches.
 */

import axios from 'axios';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

const HYPERLIQUID_API_URL = 'https://api.hyperliquid.xyz/info';
const USER_ADDRESS = process.env.MAIN_WALLET_ADDRESS;
if (!USER_ADDRESS) {
  throw new Error('MAIN_WALLET_ADDRESS environment variable is required');
}
const BATCH_SIZE = 2000;

interface TradeResponse {
  tid: number;
  time: number;
  coin: string;
  side: string;
  px: string;
  sz: string;
  dir: string;
  closedPnl: string;
  fee: string;
  oid: number;
  startPosition: string;
  crossed: boolean;
  hash: string;
  feeToken?: string;
  builderFee?: string;
}

async function fetchTradesByTime(startTime: number, endTime?: number): Promise<TradeResponse[]> {
  try {
    const payload: any = {
      type: 'userFillsByTime',
      user: USER_ADDRESS,
      startTime
    };

    if (endTime) {
      payload.endTime = endTime;
    }

    const response = await axios.post(HYPERLIQUID_API_URL, payload);

    if (!Array.isArray(response.data)) {
      console.error('Unexpected response format:', response.data);
      return [];
    }

    return response.data;
  } catch (error) {
    console.error('Error fetching trades:', error);
    throw error;
  }
}

async function getOldestTradeTime(connection: mysql.Connection): Promise<number | null> {
  const [rows]: any = await connection.execute(
    'SELECT MIN(time) as oldest FROM user_trades'
  );
  return rows[0]?.oldest || null;
}

async function upsertTrades(trades: TradeResponse[], connection: mysql.Connection) {
  if (trades.length === 0) {
    return { inserted: 0, updated: 0 };
  }

  const placeholders = trades.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
  const query = `
    INSERT INTO user_trades (
      tid, time, coin, side, px, sz, dir, closed_pnl, fee, oid, start_position, crossed
    ) VALUES ${placeholders}
    ON DUPLICATE KEY UPDATE
      time = VALUES(time),
      coin = VALUES(coin),
      side = VALUES(side),
      px = VALUES(px),
      sz = VALUES(sz),
      dir = VALUES(dir),
      closed_pnl = VALUES(closed_pnl),
      fee = VALUES(fee),
      oid = VALUES(oid),
      start_position = VALUES(start_position),
      crossed = VALUES(crossed),
      updated_at = CURRENT_TIMESTAMP
  `;

  const values: any[] = [];
  for (const trade of trades) {
    values.push(
      trade.tid,
      trade.time,
      trade.coin,
      trade.side,
      parseFloat(trade.px),
      parseFloat(trade.sz),
      trade.dir,
      parseFloat(trade.closedPnl),
      parseFloat(trade.fee),
      trade.oid,
      parseFloat(trade.startPosition),
      trade.crossed
    );
  }

  const [result]: any = await connection.execute(query, values);

  const updated = Math.max(0, (result.affectedRows - trades.length));
  const inserted = trades.length - updated;

  return { inserted, updated };
}

async function main() {
  console.log('=========================================');
  console.log('  Backfill Hyperliquid User Trades');
  console.log('=========================================');
  console.log('');
  console.log(`User Address: ${USER_ADDRESS}`);
  console.log(`Time: ${new Date().toISOString()}`);
  console.log('');

  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '3306'),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
  });

  try {
    // Get the oldest trade currently in database
    const oldestTime = await getOldestTradeTime(connection);

    if (!oldestTime) {
      console.log('No existing trades found. Fetching from beginning...');
    } else {
      const oldestDate = new Date(oldestTime);
      console.log(`Oldest trade in DB: ${oldestDate.toISOString()}`);
      console.log(`Will backfill from that point backwards...`);
      console.log('');
    }

    let totalInserted = 0;
    let totalUpdated = 0;
    let batchCount = 0;

    // Start from oldest existing trade (or now if no trades exist)
    let endTime = oldestTime || Date.now();
    let hasMore = true;

    while (hasMore && batchCount < 5) { // Max 5 batches = 10,000 trades
      batchCount++;

      console.log(`Batch ${batchCount}: Fetching trades before ${new Date(endTime).toISOString()}...`);

      // Fetch 2000 trades ending at endTime
      const trades = await fetchTradesByTime(0, endTime);

      if (trades.length === 0) {
        console.log('No more trades available');
        hasMore = false;
        break;
      }

      console.log(`✓ Fetched ${trades.length} trades`);

      // Show sample of oldest trades in this batch
      const oldest = trades.slice(-3);
      if (oldest.length > 0) {
        console.log('Oldest trades in batch:');
        oldest.reverse().forEach(trade => {
          const timestamp = new Date(trade.time).toISOString();
          const pnl = parseFloat(trade.closedPnl);
          const pnlStr = pnl > 0 ? `+$${pnl.toFixed(2)}` : `$${pnl.toFixed(2)}`;
          console.log(`  ${timestamp} | ${trade.coin} | ${trade.side === 'B' ? 'BUY' : 'SELL'} | ${trade.sz} @ $${trade.px} | P&L: ${pnlStr}`);
        });
      }

      // Upsert trades
      console.log('Upserting to database...');
      const result = await upsertTrades(trades, connection);
      totalInserted += result.inserted;
      totalUpdated += result.updated;

      console.log(`✓ Batch ${batchCount}: ${result.inserted} inserted, ${result.updated} updated`);
      console.log('');

      // Check if we got fewer than batch size (means we've reached the end)
      if (trades.length < BATCH_SIZE) {
        console.log('Received fewer than 2000 trades - reached end of available data');
        hasMore = false;
        break;
      }

      // Set endTime to the oldest trade we just fetched (minus 1ms to avoid duplicates)
      const oldestInBatch = Math.min(...trades.map(t => t.time));
      endTime = oldestInBatch - 1;
    }

    console.log('=========================================');
    console.log('✓ Backfill Complete');
    console.log('=========================================');
    console.log(`Total batches: ${batchCount}`);
    console.log(`Total inserted: ${totalInserted}`);
    console.log(`Total updated: ${totalUpdated}`);
    console.log('');

    // Show final statistics
    const [stats]: any = await connection.execute(`
      SELECT
        COUNT(*) as total,
        MIN(FROM_UNIXTIME(time/1000)) as earliest,
        MAX(FROM_UNIXTIME(time/1000)) as latest,
        COUNT(DISTINCT coin) as coins
      FROM user_trades
    `);

    console.log('Database Statistics:');
    console.log(`Total trades: ${stats[0].total}`);
    console.log(`Date range: ${stats[0].earliest} to ${stats[0].latest}`);
    console.log(`Coins traded: ${stats[0].coins}`);
    console.log('=========================================');

  } catch (error) {
    console.error('');
    console.error('=========================================');
    console.error('✗ Error during backfill');
    console.error('=========================================');
    console.error(error);
    process.exit(1);
  } finally {
    await connection.end();
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { fetchTradesByTime, upsertTrades };
