/**
 * BTC Implied Volatility Collector
 *
 * Polls Deribit every 5 minutes and stores IV data in the database.
 * This data is used to:
 * - Detect market events (Fed, CPI, geopolitical)
 * - Filter trading during high-risk periods
 * - Analyze historical IV patterns
 *
 * Run with: node dist/services/iv-collector.js
 * Or as PM2 process for 24/7 collection
 */

import { getPool } from '../storage/database.js';
import { fetchDeribitIV, DeribitIVData } from './deribit-iv.js';
import type { Pool, RowDataPacket } from 'mysql2/promise';

const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const HOURLY_AGGREGATE_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

let pool: Pool;
let isRunning = false;
let lastHourlyAggregate = 0;

/**
 * Store IV data in the database
 */
async function storeIVData(data: DeribitIVData): Promise<void> {
  await pool.execute(
    `INSERT INTO btc_implied_volatility (
      timestamp,
      btc_price,
      dvol,
      short_term_iv,
      short_term_expiry_hours,
      one_day_iv,
      iv_term_structure,
      expected_daily_move_pct,
      elevated_risk,
      risk_reason
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      btc_price = VALUES(btc_price),
      dvol = VALUES(dvol),
      short_term_iv = VALUES(short_term_iv),
      short_term_expiry_hours = VALUES(short_term_expiry_hours),
      one_day_iv = VALUES(one_day_iv),
      iv_term_structure = VALUES(iv_term_structure),
      expected_daily_move_pct = VALUES(expected_daily_move_pct),
      elevated_risk = VALUES(elevated_risk),
      risk_reason = VALUES(risk_reason)`,
    [
      data.timestamp,
      data.btc_price,
      data.dvol,
      data.short_term_iv,
      data.short_term_expiry_hours,
      data.one_day_iv,
      data.iv_term_structure,
      data.expected_daily_move_pct,
      data.elevated_risk,
      data.risk_reason
    ]
  );
}

/**
 * Compute and store hourly aggregates
 */
async function computeHourlyAggregate(hourStart: number): Promise<void> {
  const hourEnd = hourStart + HOURLY_AGGREGATE_INTERVAL_MS;

  // Get all samples for this hour
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT
      AVG(dvol) as avg_dvol,
      MIN(dvol) as min_dvol,
      MAX(dvol) as max_dvol,
      AVG(short_term_iv) as avg_short_term_iv,
      MIN(short_term_iv) as min_short_term_iv,
      MAX(short_term_iv) as max_short_term_iv,
      AVG(expected_daily_move_pct) as avg_expected_daily_move,
      SUM(elevated_risk) as elevated_risk_count,
      COUNT(*) as sample_count,
      (SELECT btc_price FROM btc_implied_volatility WHERE timestamp >= ? AND timestamp < ? ORDER BY timestamp ASC LIMIT 1) as btc_price_open,
      (SELECT btc_price FROM btc_implied_volatility WHERE timestamp >= ? AND timestamp < ? ORDER BY timestamp DESC LIMIT 1) as btc_price_close,
      MIN(btc_price) as btc_price_low,
      MAX(btc_price) as btc_price_high
    FROM btc_implied_volatility
    WHERE timestamp >= ? AND timestamp < ?`,
    [hourStart, hourEnd, hourStart, hourEnd, hourStart, hourEnd]
  );

  if (rows.length === 0 || rows[0].sample_count === 0) {
    return;
  }

  const agg = rows[0];

  await pool.execute(
    `INSERT INTO btc_iv_hourly (
      hour_timestamp,
      avg_dvol, min_dvol, max_dvol,
      avg_short_term_iv, min_short_term_iv, max_short_term_iv,
      avg_expected_daily_move,
      elevated_risk_count,
      sample_count,
      btc_price_open, btc_price_close, btc_price_high, btc_price_low
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      avg_dvol = VALUES(avg_dvol),
      min_dvol = VALUES(min_dvol),
      max_dvol = VALUES(max_dvol),
      avg_short_term_iv = VALUES(avg_short_term_iv),
      min_short_term_iv = VALUES(min_short_term_iv),
      max_short_term_iv = VALUES(max_short_term_iv),
      avg_expected_daily_move = VALUES(avg_expected_daily_move),
      elevated_risk_count = VALUES(elevated_risk_count),
      sample_count = VALUES(sample_count),
      btc_price_open = VALUES(btc_price_open),
      btc_price_close = VALUES(btc_price_close),
      btc_price_high = VALUES(btc_price_high),
      btc_price_low = VALUES(btc_price_low)`,
    [
      hourStart,
      agg.avg_dvol, agg.min_dvol, agg.max_dvol,
      agg.avg_short_term_iv, agg.min_short_term_iv, agg.max_short_term_iv,
      agg.avg_expected_daily_move,
      agg.elevated_risk_count,
      agg.sample_count,
      agg.btc_price_open, agg.btc_price_close, agg.btc_price_high, agg.btc_price_low
    ]
  );

  console.log(`📊 Hourly aggregate stored for ${new Date(hourStart).toISOString()}`);
}

/**
 * Single poll cycle
 */
async function poll(): Promise<void> {
  try {
    // Fetch IV data from Deribit
    const ivData = await fetchDeribitIV();

    // Store in database
    await storeIVData(ivData);

    // Log status
    const riskIcon = ivData.elevated_risk ? '⚠️' : '✅';
    console.log(
      `${riskIcon} [${new Date().toISOString()}] ` +
      `BTC: $${ivData.btc_price.toLocaleString()} | ` +
      `DVOL: ${ivData.dvol.toFixed(1)}% | ` +
      `Short IV: ${ivData.short_term_iv.toFixed(1)}% | ` +
      `Move: ${ivData.expected_daily_move_pct.toFixed(2)}%` +
      (ivData.elevated_risk ? ` | RISK: ${ivData.risk_reason}` : '')
    );

    // Check if we need to compute hourly aggregate
    const currentHour = Math.floor(Date.now() / HOURLY_AGGREGATE_INTERVAL_MS) * HOURLY_AGGREGATE_INTERVAL_MS;
    const previousHour = currentHour - HOURLY_AGGREGATE_INTERVAL_MS;

    if (lastHourlyAggregate < previousHour) {
      await computeHourlyAggregate(previousHour);
      lastHourlyAggregate = previousHour;
    }

  } catch (error) {
    console.error(`❌ [${new Date().toISOString()}] Error polling IV:`, error);
  }
}

/**
 * Start the collector
 */
async function start(): Promise<void> {
  if (isRunning) {
    console.log('IV collector already running');
    return;
  }

  console.log('🚀 Starting BTC IV Collector');
  console.log(`   Poll interval: ${POLL_INTERVAL_MS / 1000} seconds`);
  console.log(`   Data source: Deribit Options`);
  console.log('');

  pool = getPool();
  isRunning = true;

  // Initial poll
  await poll();

  // Schedule recurring polls
  setInterval(poll, POLL_INTERVAL_MS);

  console.log('✅ IV Collector running. Press Ctrl+C to stop.\n');
}

/**
 * Graceful shutdown
 */
async function stop(): Promise<void> {
  console.log('\n🛑 Stopping IV Collector...');
  isRunning = false;
  if (pool) {
    await pool.end();
  }
  console.log('✅ IV Collector stopped');
  process.exit(0);
}

// Handle shutdown signals
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  start().catch(console.error);
}

export { start, stop, poll };
