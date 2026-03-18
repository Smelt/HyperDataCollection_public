/**
 * Rate Limit Monitor
 *
 * Polls Hyperliquid's userRateLimit endpoint every minute and stores snapshots
 * to the database for Grafana visualization.
 *
 * Tracks:
 * - Requests used / cap
 * - Cumulative volume
 * - Deltas between snapshots (requests per dollar efficiency)
 *
 * Usage:
 *   npm run monitor:rate-limit
 */

import * as hl from '@nktkas/hyperliquid';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

const POLL_INTERVAL_MS = 60 * 1000; // 1 minute
const WALLET_ADDRESS = process.env.MAIN_WALLET_ADDRESS;
if (!WALLET_ADDRESS) {
  throw new Error('MAIN_WALLET_ADDRESS environment variable is required');
}

interface RateLimitSnapshot {
  requestsUsed: number;
  requestsCap: number;
  cumVolume: number;
  timestamp: Date;
}

interface SnapshotWithDelta extends RateLimitSnapshot {
  requestsDelta: number;
  volumeDelta: number;
  requestsPerDollar: number | null;
}

let lastSnapshot: RateLimitSnapshot | null = null;
let connection: mysql.Connection | null = null;

/**
 * Create the database table if it doesn't exist
 */
async function ensureTable(conn: mysql.Connection): Promise<void> {
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS rate_limit_snapshots (
      id INT AUTO_INCREMENT PRIMARY KEY,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      requests_used BIGINT NOT NULL,
      requests_cap BIGINT NOT NULL,
      cum_volume DECIMAL(18,2) NOT NULL,
      requests_delta INT DEFAULT 0,
      volume_delta DECIMAL(18,2) DEFAULT 0,
      requests_per_dollar DECIMAL(10,4) DEFAULT NULL,
      headroom INT GENERATED ALWAYS AS (requests_cap - requests_used) STORED,
      utilization_pct DECIMAL(5,2) GENERATED ALWAYS AS (requests_used / requests_cap * 100) STORED,
      INDEX idx_timestamp (timestamp),
      INDEX idx_utilization (utilization_pct)
    )
  `);
  console.log('✅ Table rate_limit_snapshots ready');
}

/**
 * Get the last snapshot from database (for calculating deltas on restart)
 */
async function getLastSnapshotFromDb(conn: mysql.Connection): Promise<RateLimitSnapshot | null> {
  const [rows] = await conn.execute(`
    SELECT requests_used, requests_cap, cum_volume, timestamp
    FROM rate_limit_snapshots
    ORDER BY timestamp DESC
    LIMIT 1
  `);

  const result = rows as any[];
  if (result.length === 0) {
    return null;
  }

  return {
    requestsUsed: result[0].requests_used,
    requestsCap: result[0].requests_cap,
    cumVolume: parseFloat(result[0].cum_volume),
    timestamp: result[0].timestamp,
  };
}

/**
 * Fetch rate limit from Hyperliquid API
 */
async function fetchRateLimit(): Promise<RateLimitSnapshot> {
  const transport = new hl.HttpTransport();

  const response = await transport.request('info', {
    type: 'userRateLimit',
    user: WALLET_ADDRESS,
  }) as any;

  return {
    requestsUsed: response.nRequestsUsed,
    requestsCap: response.nRequestsCap,
    cumVolume: parseFloat(response.cumVlm),
    timestamp: new Date(),
  };
}

/**
 * Calculate deltas from previous snapshot
 */
function calculateDeltas(current: RateLimitSnapshot, previous: RateLimitSnapshot | null): SnapshotWithDelta {
  if (!previous) {
    return {
      ...current,
      requestsDelta: 0,
      volumeDelta: 0,
      requestsPerDollar: null,
    };
  }

  const requestsDelta = current.requestsUsed - previous.requestsUsed;
  const volumeDelta = current.cumVolume - previous.cumVolume;

  // Calculate efficiency ratio (requests per dollar of volume)
  // Lower is better - means you're trading efficiently
  const requestsPerDollar = volumeDelta > 0
    ? requestsDelta / volumeDelta
    : null;

  return {
    ...current,
    requestsDelta,
    volumeDelta,
    requestsPerDollar,
  };
}

/**
 * Store snapshot to database
 */
async function storeSnapshot(conn: mysql.Connection, snapshot: SnapshotWithDelta): Promise<void> {
  // Use UTC_TIMESTAMP() for consistent timezone handling with Grafana
  await conn.execute(`
    INSERT INTO rate_limit_snapshots
    (timestamp, requests_used, requests_cap, cum_volume, requests_delta, volume_delta, requests_per_dollar)
    VALUES (UTC_TIMESTAMP(), ?, ?, ?, ?, ?, ?)
  `, [
    snapshot.requestsUsed,
    snapshot.requestsCap,
    snapshot.cumVolume,
    snapshot.requestsDelta,
    snapshot.volumeDelta,
    snapshot.requestsPerDollar,
  ]);
}

/**
 * Format number with commas
 */
function formatNum(n: number): string {
  return n.toLocaleString();
}

/**
 * Log snapshot to console
 */
function logSnapshot(snapshot: SnapshotWithDelta): void {
  const headroom = snapshot.requestsCap - snapshot.requestsUsed;
  const utilization = (snapshot.requestsUsed / snapshot.requestsCap * 100).toFixed(1);

  const timestamp = snapshot.timestamp.toISOString().replace('T', ' ').substring(0, 19);

  console.log(`[${timestamp}] Requests: ${formatNum(snapshot.requestsUsed)}/${formatNum(snapshot.requestsCap)} (${utilization}%) | Headroom: ${formatNum(headroom)} | Vol: $${formatNum(snapshot.cumVolume)}`);

  if (snapshot.requestsDelta !== 0 || snapshot.volumeDelta !== 0) {
    const efficiencyStr = snapshot.requestsPerDollar !== null
      ? snapshot.requestsPerDollar.toFixed(2) + ' req/$'
      : 'N/A';

    const deltaSign = snapshot.requestsDelta >= 0 ? '+' : '';
    const volSign = snapshot.volumeDelta >= 0 ? '+' : '';

    console.log(`   Δ Requests: ${deltaSign}${snapshot.requestsDelta} | Δ Volume: ${volSign}$${snapshot.volumeDelta.toFixed(2)} | Efficiency: ${efficiencyStr}`);

    // Warn if efficiency is bad
    if (snapshot.requestsPerDollar !== null) {
      if (snapshot.requestsPerDollar > 2.0) {
        console.log(`   ⚠️  HIGH REQUEST RATE: ${snapshot.requestsPerDollar.toFixed(2)} req/$ (burning headroom fast)`);
      } else if (snapshot.requestsPerDollar > 1.0) {
        console.log(`   ⚡ Moderate rate: ${snapshot.requestsPerDollar.toFixed(2)} req/$ (using headroom)`);
      } else if (snapshot.requestsPerDollar > 0) {
        console.log(`   ✅ Efficient: ${snapshot.requestsPerDollar.toFixed(2)} req/$ (gaining headroom)`);
      }
    }
  }
}

/**
 * Main polling loop
 */
async function pollOnce(): Promise<void> {
  try {
    const current = await fetchRateLimit();
    const snapshot = calculateDeltas(current, lastSnapshot);

    if (connection) {
      await storeSnapshot(connection, snapshot);
    }

    logSnapshot(snapshot);
    lastSnapshot = current;
  } catch (error: any) {
    console.error(`❌ Poll failed: ${error?.message || error}`);
  }
}

/**
 * Cleanup on exit
 */
async function cleanup(): Promise<void> {
  console.log('\n🛑 Stopping rate limit monitor...');
  if (connection) {
    await connection.end();
  }
  process.exit(0);
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  Rate Limit Monitor');
  console.log('  Wallet: ' + WALLET_ADDRESS);
  console.log('  Polling interval: 1 minute');
  console.log('═══════════════════════════════════════════════════════════');
  console.log();

  // Connect to database
  connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '3306'),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  console.log('✅ Connected to database');

  // Ensure table exists
  await ensureTable(connection);

  // Get last snapshot from DB (for calculating first delta)
  lastSnapshot = await getLastSnapshotFromDb(connection);
  if (lastSnapshot) {
    console.log(`📊 Loaded last snapshot from DB (${lastSnapshot.timestamp.toISOString()})`);
  }
  console.log();

  // Setup graceful shutdown
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  // Initial poll
  await pollOnce();

  // Start polling loop
  setInterval(pollOnce, POLL_INTERVAL_MS);

  console.log(`\n⏰ Polling every ${POLL_INTERVAL_MS / 1000}s. Press Ctrl+C to stop.\n`);
}

// Run
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
