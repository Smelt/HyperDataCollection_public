#!/usr/bin/env ts-node
/**
 * Fetch Hyperliquid User Trades
 *
 * Fetches user trade fills from Hyperliquid API and upserts them into the database.
 * Runs every minute via cron to keep trade history up to date.
 */

import axios from 'axios';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const HYPERLIQUID_API_URL = 'https://api.hyperliquid.xyz/info';
const USER_ADDRESS = process.env.MAIN_WALLET_ADDRESS;
if (!USER_ADDRESS) {
  throw new Error('MAIN_WALLET_ADDRESS environment variable is required');
}

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

async function fetchUserTrades(): Promise<TradeResponse[]> {
  try {
    const response = await axios.post(HYPERLIQUID_API_URL, {
      type: 'userFills',
      user: USER_ADDRESS
    });

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

async function upsertTrades(trades: TradeResponse[]) {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '3306'),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
  });

  try {
    if (trades.length === 0) {
      return { inserted: 0, updated: 0 };
    }

    // Build bulk insert query
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

    // Flatten all values into a single array
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

    // MySQL returns affectedRows = insertCount + (updateCount * 2)
    // So if affectedRows = 2000 and we inserted 2000 rows, insertCount = 2000
    // If affectedRows = 1000 and we have 1000 rows, all were duplicates (updated)
    const updated = Math.max(0, (result.affectedRows - result.insertId) / 2);
    const inserted = trades.length - updated;

    console.log(`✓ Trades processed: ${Math.floor(inserted)} inserted, ${Math.floor(updated)} updated`);
    return { inserted: Math.floor(inserted), updated: Math.floor(updated) };
  } catch (error) {
    console.error('Error upserting trades:', error);
    throw error;
  } finally {
    await connection.end();
  }
}

async function main() {
  console.log('=========================================');
  console.log('  Fetch Hyperliquid User Trades');
  console.log('=========================================');
  console.log('');
  console.log(`User Address: ${USER_ADDRESS}`);
  console.log(`Time: ${new Date().toISOString()}`);
  console.log('');

  try {
    // Fetch trades from Hyperliquid API
    console.log('Fetching trades from Hyperliquid...');
    const trades = await fetchUserTrades();
    console.log(`✓ Fetched ${trades.length} trades`);

    if (trades.length === 0) {
      console.log('No trades to process');
      return;
    }

    // Display sample of most recent trades
    const recent = trades.slice(0, 3);
    console.log('');
    console.log('Most recent trades:');
    recent.forEach(trade => {
      const timestamp = new Date(trade.time).toISOString();
      const pnl = parseFloat(trade.closedPnl);
      const pnlStr = pnl > 0 ? `+$${pnl.toFixed(2)}` : `$${pnl.toFixed(2)}`;
      console.log(`  ${timestamp} | ${trade.coin} | ${trade.side === 'B' ? 'BUY' : 'SELL'} | ${trade.sz} @ $${trade.px} | P&L: ${pnlStr}`);
    });
    console.log('');

    // Upsert trades into database
    console.log('Upserting trades to database...');
    await upsertTrades(trades);

    console.log('');
    console.log('=========================================');
    console.log('✓ Trade sync complete');
    console.log('=========================================');
  } catch (error) {
    console.error('');
    console.error('=========================================');
    console.error('✗ Error syncing trades');
    console.error('=========================================');
    console.error(error);
    process.exit(1);
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { fetchUserTrades, upsertTrades };
