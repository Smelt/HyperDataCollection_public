import express, { Request, Response } from 'express';
import cors from 'cors';
import { getPool } from '../storage/database.js';
import { TradeSizeRepository } from '../storage/trade-size-repo.js';
import { fetchDeribitIV, DeribitIVData } from '../services/deribit-iv.js';

const app = express();
app.use(cors());
app.use(express.json());

const pool = getPool();
const tradeSizeRepo = new TradeSizeRepository(pool);

/**
 * GET /api/spread/:pair/current
 * Returns the most recent spread snapshot for a pair
 */
app.get('/api/spread/:pair/current', async (req: Request, res: Response): Promise<void> => {
  const { pair } = req.params;

  try {
    const [rows] = await pool.execute<any[]>(
      `SELECT
        timestamp,
        pair,
        best_bid,
        best_ask,
        spread_bps,
        spread_pct,
        mid_price,
        bid_size,
        ask_size,
        imbalance
      FROM spread_snapshots_partitioned
      WHERE pair = ?
      ORDER BY timestamp DESC
      LIMIT 1`,
      [pair.toUpperCase()]
    );

    if (rows.length === 0) {
      res.status(404).json({ error: 'Pair not found' });
      return;
    }

    const snapshot = rows[0];
    res.json({
      pair: snapshot.pair,
      timestamp: snapshot.timestamp,
      spread_bps: parseFloat(snapshot.spread_bps),
      spread_pct: parseFloat(snapshot.spread_pct),
      best_bid: parseFloat(snapshot.best_bid),
      best_ask: parseFloat(snapshot.best_ask),
      mid_price: parseFloat(snapshot.mid_price),
      bid_size: parseFloat(snapshot.bid_size),
      ask_size: parseFloat(snapshot.ask_size),
      imbalance: parseFloat(snapshot.imbalance)
    });
  } catch (error) {
    console.error('Error fetching current spread:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/spread/:pair/average?hours=1
 * Returns the average spread over the specified time period
 */
app.get('/api/spread/:pair/average', async (req: Request, res: Response): Promise<void> => {
  const { pair } = req.params;
  const hours = parseInt(req.query.hours as string) || 1;

  try {
    const cutoffTime = Date.now() - (hours * 60 * 60 * 1000);

    const [rows] = await pool.execute<any[]>(
      `SELECT
        COUNT(*) as sample_count,
        AVG(spread_bps) as avg_spread_bps,
        AVG(spread_pct) as avg_spread_pct,
        MIN(spread_bps) as min_spread_bps,
        MAX(spread_bps) as max_spread_bps,
        STDDEV(spread_bps) as stddev_spread_bps
      FROM spread_snapshots_partitioned
      WHERE pair = ? AND timestamp >= ?`,
      [pair.toUpperCase(), cutoffTime]
    );

    if (rows.length === 0 || rows[0].sample_count === 0) {
      res.status(404).json({ error: 'No data found for time period' });
      return;
    }

    const stats = rows[0];
    res.json({
      pair: pair.toUpperCase(),
      hours,
      sample_count: stats.sample_count,
      avg_spread_bps: parseFloat(stats.avg_spread_bps),
      avg_spread_pct: parseFloat(stats.avg_spread_pct),
      min_spread_bps: parseFloat(stats.min_spread_bps),
      max_spread_bps: parseFloat(stats.max_spread_bps),
      stddev_spread_bps: parseFloat(stats.stddev_spread_bps || 0)
    });
  } catch (error) {
    console.error('Error fetching average spread:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/spread/:pair/opportunity?threshold=1.5
 * Check if current spread is X times higher than hourly average
 * Returns whether it's a trading opportunity
 */
app.get('/api/spread/:pair/opportunity', async (req: Request, res: Response): Promise<void> => {
  const { pair } = req.params;
  const threshold = parseFloat(req.query.threshold as string) || 1.5;

  try {
    // Get current spread
    const [currentRows] = await pool.execute<any[]>(
      `SELECT spread_bps, spread_pct, best_bid, best_ask, mid_price
      FROM spread_snapshots_partitioned
      WHERE pair = ?
      ORDER BY timestamp DESC
      LIMIT 1`,
      [pair.toUpperCase()]
    );

    if (currentRows.length === 0) {
      res.status(404).json({ error: 'Pair not found' });
      return;
    }

    // Get hourly average
    const cutoffTime = Date.now() - (60 * 60 * 1000);
    const [avgRows] = await pool.execute<any[]>(
      `SELECT AVG(spread_bps) as avg_spread_bps
      FROM spread_snapshots_partitioned
      WHERE pair = ? AND timestamp >= ?`,
      [pair.toUpperCase(), cutoffTime]
    );

    if (avgRows.length === 0 || !avgRows[0].avg_spread_bps) {
      res.status(404).json({ error: 'No historical data' });
      return;
    }

    const currentSpreadBps = parseFloat(currentRows[0].spread_bps);
    const avgSpreadBps = parseFloat(avgRows[0].avg_spread_bps);
    const deviation = currentSpreadBps / avgSpreadBps;
    const isOpportunity = deviation >= threshold;

    res.json({
      pair: pair.toUpperCase(),
      current_spread_bps: currentSpreadBps,
      avg_spread_1h_bps: avgSpreadBps,
      deviation: parseFloat(deviation.toFixed(2)),
      threshold,
      is_opportunity: isOpportunity,
      best_bid: parseFloat(currentRows[0].best_bid),
      best_ask: parseFloat(currentRows[0].best_ask),
      mid_price: parseFloat(currentRows[0].mid_price)
    });
  } catch (error) {
    console.error('Error checking opportunity:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/pairs/active
 * Returns list of pairs currently being monitored
 */
app.get('/api/pairs/active', async (_req: Request, res: Response) => {
  try {
    const cutoffTime = Date.now() - (10 * 60 * 1000); // Last 10 minutes

    const [rows] = await pool.execute<any[]>(
      `SELECT DISTINCT pair
      FROM spread_snapshots_partitioned
      WHERE timestamp >= ?
      ORDER BY pair`,
      [cutoffTime]
    );

    res.json({
      pairs: rows.map(r => r.pair),
      count: rows.length
    });
  } catch (error) {
    console.error('Error fetching active pairs:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/market/snapshot
 * Returns comprehensive spread statistics for all active pairs (last 15 minutes)
 * Includes: latest, average, median, 75th percentile, 90th percentile
 */
app.get('/api/market/snapshot', async (_req: Request, res: Response) => {
  try {
    const cutoffTime = Date.now() - (15 * 60 * 1000); // Last 15 minutes

    const [rows] = await pool.execute<any[]>(
      `WITH ranked_spreads AS (
        SELECT
          pair,
          spread_bps,
          timestamp,
          ROW_NUMBER() OVER (PARTITION BY pair ORDER BY timestamp DESC) as recency_rank,
          PERCENT_RANK() OVER (PARTITION BY pair ORDER BY spread_bps) as pct_rank
        FROM spread_snapshots_partitioned
        WHERE timestamp >= ?
      )
      SELECT
        pair,
        MAX(CASE WHEN recency_rank = 1 THEN spread_bps END) as latest_spread_bps,
        ROUND(AVG(spread_bps), 2) as avg_spread_bps,
        ROUND(MIN(CASE WHEN pct_rank >= 0.50 THEN spread_bps END), 2) as median_spread_bps,
        ROUND(MIN(CASE WHEN pct_rank >= 0.75 THEN spread_bps END), 2) as p75_spread_bps,
        ROUND(MIN(CASE WHEN pct_rank >= 0.90 THEN spread_bps END), 2) as p90_spread_bps,
        ROUND(MIN(spread_bps), 2) as min_spread_bps,
        ROUND(MAX(spread_bps), 2) as max_spread_bps,
        COUNT(*) as sample_count,
        MAX(timestamp) as latest_timestamp
      FROM ranked_spreads
      GROUP BY pair
      HAVING sample_count > 10
      ORDER BY avg_spread_bps DESC`,
      [cutoffTime]
    );

    const snapshot = rows.map(row => ({
      pair: row.pair,
      latest_spread_bps: parseFloat(row.latest_spread_bps),
      avg_spread_bps: parseFloat(row.avg_spread_bps),
      median_spread_bps: parseFloat(row.median_spread_bps),
      p75_spread_bps: parseFloat(row.p75_spread_bps),
      p90_spread_bps: parseFloat(row.p90_spread_bps),
      min_spread_bps: parseFloat(row.min_spread_bps),
      max_spread_bps: parseFloat(row.max_spread_bps),
      sample_count: row.sample_count,
      latest_timestamp: row.latest_timestamp
    }));

    res.json({
      timestamp: Date.now(),
      window_minutes: 15,
      pairs: snapshot
    });
  } catch (error) {
    console.error('Error fetching market snapshot:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/volatility/:pair?window=10
 * Returns volatility metrics for trading decisions
 *
 * Calculates:
 * - Price volatility (std dev of mid prices) over the window
 * - Spread-to-volatility ratio
 * - Market state classification (IDEAL, LOW_VOL, CHOPPY, DANGEROUS)
 * - Trading recommendation
 */
app.get('/api/volatility/:pair', async (req: Request, res: Response) => {
  const { pair } = req.params;
  const windowMinutes = parseInt(req.query.window as string) || 10;

  try {
    const cutoffTime = Date.now() - (windowMinutes * 60 * 1000);

    // Get volatility stats and current spread in one query
    const [rows] = await pool.execute<any[]>(
      `SELECT
        COUNT(*) as sample_count,
        AVG(mid_price) as avg_mid_price,
        STDDEV(mid_price) as std_mid_price,
        MIN(mid_price) as min_mid_price,
        MAX(mid_price) as max_mid_price,
        (SELECT spread_bps FROM spread_snapshots_partitioned
         WHERE pair = ? ORDER BY timestamp DESC LIMIT 1) as current_spread_bps,
        (SELECT mid_price FROM spread_snapshots_partitioned
         WHERE pair = ? ORDER BY timestamp DESC LIMIT 1) as current_mid_price
      FROM spread_snapshots_partitioned
      WHERE pair = ? AND timestamp >= ?`,
      [pair.toUpperCase(), pair.toUpperCase(), pair.toUpperCase(), cutoffTime]
    );

    if (rows.length === 0 || rows[0].sample_count < 10) {
      res.status(404).json({ error: 'Insufficient data for volatility calculation' });
      return;
    }

    const stats = rows[0];
    const avgMidPrice = parseFloat(stats.avg_mid_price);
    const stdMidPrice = parseFloat(stats.std_mid_price) || 0;
    const currentSpreadBps = parseFloat(stats.current_spread_bps) || 0;

    // Calculate volatility in basis points
    const volatilityBps = avgMidPrice > 0 ? (stdMidPrice / avgMidPrice) * 10000 : 0;

    // Calculate price range in basis points
    const minMid = parseFloat(stats.min_mid_price);
    const maxMid = parseFloat(stats.max_mid_price);
    const priceRangeBps = avgMidPrice > 0 ? ((maxMid - minMid) / avgMidPrice) * 10000 : 0;

    // Calculate spread-to-volatility ratio
    const spreadVolRatio = volatilityBps > 0 ? currentSpreadBps / volatilityBps : 999;

    // Determine market state based on spread-to-volatility ratio
    // Backtest results (Jan 5-12, 404 trades):
    //   ratio >= 1.0: 78.4% win rate, +$11.14 PnL
    //   ratio < 1.0:  56.6% win rate, -$9.06 PnL
    // Key insight: Low ratio means price moves faster than spread can capture
    let marketState: string;
    let shouldTrade: boolean;

    // Primary filter: spread-to-volatility ratio (from backtest)
    const MIN_RATIO_THRESHOLD = 1.0;

    if (volatilityBps > 100) {
      // Extreme volatility - always dangerous regardless of ratio
      marketState = 'DANGEROUS';
      shouldTrade = false;
    } else if (spreadVolRatio < MIN_RATIO_THRESHOLD) {
      // Bad ratio - price volatility exceeds spread, likely to lose
      marketState = 'CHOPPY';
      shouldTrade = false;
    } else if (spreadVolRatio >= 2.0 && volatilityBps < 50) {
      // Great conditions - high ratio with low volatility
      marketState = 'IDEAL';
      shouldTrade = true;
    } else if (spreadVolRatio >= MIN_RATIO_THRESHOLD) {
      // Acceptable ratio - spread can capture price movement
      marketState = 'FAVORABLE';
      shouldTrade = true;
    } else {
      // Fallback (shouldn't reach here)
      marketState = 'UNKNOWN';
      shouldTrade = false;
    }

    res.json({
      pair: pair.toUpperCase(),
      timestamp: Date.now(),
      window_minutes: windowMinutes,

      // Volatility metrics
      volatility_bps: parseFloat(volatilityBps.toFixed(2)),
      price_range_bps: parseFloat(priceRangeBps.toFixed(2)),

      // Current spread
      current_spread_bps: parseFloat(currentSpreadBps.toFixed(2)),
      spread_vol_ratio: parseFloat(spreadVolRatio.toFixed(2)),

      // Trading signal
      market_state: marketState,
      should_trade: shouldTrade,

      // Raw data
      sample_count: stats.sample_count,
      mid_price_avg: parseFloat(avgMidPrice.toFixed(10)),
      mid_price_std: parseFloat(stdMidPrice.toFixed(10))
    });
  } catch (error) {
    console.error('Error calculating volatility:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/trades/:pair/size-stats
 * Returns trade size statistics with customizable percentiles for position sizing
 *
 * Query params:
 * - hours: Time window (default: 1)
 * - percentiles: Comma-separated list of percentiles (default: 25,50,75)
 *
 * Example: GET /api/trades/MON/size-stats?hours=1&percentiles=10,25,50,75,90
 */
app.get('/api/trades/:pair/size-stats', async (req: Request, res: Response) => {
  const { pair } = req.params;
  const hours = parseFloat(req.query.hours as string) || 1;

  // Parse percentiles from query string
  const percentilesStr = (req.query.percentiles as string) || '25,50,75';
  const percentiles = percentilesStr
    .split(',')
    .map((p) => parseInt(p.trim()))
    .filter((p) => p >= 1 && p <= 99);

  if (percentiles.length === 0) {
    res.status(400).json({ error: 'Invalid percentiles. Must be 1-99.' });
    return;
  }

  try {
    const stats = await tradeSizeRepo.getStatsOptimized(
      pair.toUpperCase(),
      hours,
      percentiles
    );

    if (!stats) {
      res.status(404).json({
        error: 'No trade data found',
        pair: pair.toUpperCase(),
        hours,
      });
      return;
    }

    res.json({
      pair: stats.pair,
      hours: stats.hours,
      sample_count: stats.sampleCount,
      avg_size: parseFloat(stats.avgSize.toFixed(4)),
      min_size: parseFloat(stats.minSize.toFixed(4)),
      max_size: parseFloat(stats.maxSize.toFixed(4)),
      avg_notional_usd: parseFloat(stats.avgNotionalUsd.toFixed(2)),
      percentiles: stats.percentiles,
      // Convenience fields for common use cases
      p25_size: stats.percentiles[25] || null,
      p50_size: stats.percentiles[50] || null,
      p75_size: stats.percentiles[75] || null,
    });
  } catch (error) {
    console.error('Error fetching trade size stats:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/trades/:pair/recommended-size
 * Returns recommended position size based on market activity
 *
 * Query params:
 * - hours: Time window (default: 1)
 * - percentile: Which percentile to use (default: 25)
 * - max_notional_usd: Maximum position size in USD (optional)
 *
 * Example: GET /api/trades/MON/recommended-size?percentile=25&max_notional_usd=1000
 */
app.get('/api/trades/:pair/recommended-size', async (req: Request, res: Response) => {
  const { pair } = req.params;
  const hours = parseFloat(req.query.hours as string) || 1;
  const percentile = parseInt(req.query.percentile as string) || 25;
  const maxNotionalUsd = parseFloat(req.query.max_notional_usd as string) || Infinity;

  if (percentile < 1 || percentile > 99) {
    res.status(400).json({ error: 'Percentile must be between 1 and 99' });
    return;
  }

  try {
    const stats = await tradeSizeRepo.getStatsOptimized(
      pair.toUpperCase(),
      hours,
      [percentile]
    );

    if (!stats || !stats.percentiles[percentile]) {
      res.status(404).json({
        error: 'Insufficient trade data',
        pair: pair.toUpperCase(),
        hours,
      });
      return;
    }

    const recommendedSize = stats.percentiles[percentile];
    const currentPrice = stats.avgNotionalUsd / stats.avgSize; // Approximate current price
    const notionalUsd = recommendedSize * currentPrice;

    // Apply max notional cap if specified
    let finalSize = recommendedSize;
    let capped = false;

    if (notionalUsd > maxNotionalUsd && currentPrice > 0) {
      finalSize = maxNotionalUsd / currentPrice;
      capped = true;
    }

    res.json({
      pair: pair.toUpperCase(),
      hours,
      percentile_used: percentile,
      recommended_size: parseFloat(finalSize.toFixed(4)),
      estimated_notional_usd: parseFloat((finalSize * currentPrice).toFixed(2)),
      was_capped: capped,
      max_notional_usd: maxNotionalUsd === Infinity ? null : maxNotionalUsd,
      market_context: {
        sample_count: stats.sampleCount,
        avg_trade_size: parseFloat(stats.avgSize.toFixed(4)),
        percentile_size: parseFloat(recommendedSize.toFixed(4)),
      },
    });
  } catch (error) {
    console.error('Error calculating recommended size:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/trades/:pair/recent
 * Returns recent trades for a pair (for position sizing)
 *
 * Query params:
 * - limit: Number of trades to return (default: 100, max: 500)
 * - hours: Time window to search in (default: 24)
 *
 * Example: GET /api/trades/HYPE/recent?limit=100&hours=24
 */
app.get('/api/trades/:pair/recent', async (req: Request, res: Response) => {
  const { pair } = req.params;
  const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
  const hours = parseFloat(req.query.hours as string) || 24;

  try {
    const trades = await tradeSizeRepo.getRecentTrades(
      pair.toUpperCase(),
      limit,
      hours
    );

    res.json({
      pair: pair.toUpperCase(),
      count: trades.length,
      limit,
      hours,
      trades: trades.map((t) => ({
        trade_id: t.tradeId,
        size: t.size,
        price: t.price,
        side: t.side,
        timestamp: t.timestamp,
      })),
    });
  } catch (error) {
    console.error('Error fetching recent trades:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/trades/pairs
 * Returns list of pairs with trade size data
 *
 * Query params:
 * - hours: Time window (default: 1)
 */
app.get('/api/trades/pairs', async (req: Request, res: Response) => {
  const hours = parseFloat(req.query.hours as string) || 1;

  try {
    const pairs = await tradeSizeRepo.getActivePairs(hours);

    res.json({
      pairs,
      count: pairs.length,
      hours,
    });
  } catch (error) {
    console.error('Error fetching trade pairs:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/trades/:pair/volume?minutes=5
 * Returns recent trading activity for volume-based filtering
 *
 * Used by trading bot to decide whether to trade (avoid burning requests on dead markets)
 *
 * Thresholds:
 * - ACTIVE: >$200/5min OR >3 trades → should_trade: true
 * - DORMANT: below both thresholds → should_trade: false
 */
app.get('/api/trades/:pair/volume', async (req: Request, res: Response) => {
  const { pair } = req.params;
  const minutes = parseInt(req.query.minutes as string) || 5;
  const minVolumeUsd = parseFloat(req.query.min_volume_usd as string) || 200;
  const minTrades = parseInt(req.query.min_trades as string) || 3;

  try {
    const cutoffTime = Date.now() - (minutes * 60 * 1000);

    const [rows] = await pool.execute<any[]>(
      `SELECT
        COUNT(*) as trade_count,
        COALESCE(SUM(notional_usd), 0) as volume_usd,
        COALESCE(AVG(notional_usd), 0) as avg_trade_usd
      FROM trade_sizes
      WHERE pair = ? AND timestamp >= ?`,
      [pair.toUpperCase(), cutoffTime]
    );

    const stats = rows[0];
    const tradeCount = parseInt(stats.trade_count) || 0;
    const volumeUsd = parseFloat(stats.volume_usd) || 0;
    const avgTradeUsd = parseFloat(stats.avg_trade_usd) || 0;
    const tradesPerMinute = tradeCount / minutes;

    // Determine if market is active enough to trade
    const isActive = volumeUsd >= minVolumeUsd || tradeCount >= minTrades;

    res.json({
      pair: pair.toUpperCase(),
      minutes,
      trade_count: tradeCount,
      volume_usd: parseFloat(volumeUsd.toFixed(2)),
      avg_trade_usd: parseFloat(avgTradeUsd.toFixed(2)),
      trades_per_minute: parseFloat(tradesPerMinute.toFixed(2)),
      // Thresholds used
      thresholds: {
        min_volume_usd: minVolumeUsd,
        min_trades: minTrades,
      },
      // Trading signal
      should_trade: isActive,
    });
  } catch (error) {
    console.error('Error fetching volume:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================================
// METRICS ENDPOINTS - API Usage Tracking
// ============================================================================

/**
 * POST /api/metrics/requests
 * Record API request counts from trading executors
 *
 * Body:
 * {
 *   "executor": "MON",
 *   "place_order": 5,
 *   "cancel_order": 3,
 *   "modify_order": 12,
 *   "cancel_all": 1,
 *   "interval_ms": 60000
 * }
 */
app.post('/api/metrics/requests', async (req: Request, res: Response) => {
  const {
    executor,
    place_order = 0,
    cancel_order = 0,
    modify_order = 0,
    cancel_all = 0,
    interval_ms = 60000,
  } = req.body;

  if (!executor) {
    res.status(400).json({ error: 'executor is required' });
    return;
  }

  try {
    const timestamp = Date.now();

    await pool.execute(
      `INSERT INTO request_metrics
        (timestamp, executor, place_order, cancel_order, modify_order, cancel_all, interval_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [timestamp, executor, place_order, cancel_order, modify_order, cancel_all, interval_ms]
    );

    const total = place_order + cancel_order + modify_order + cancel_all;
    console.log(`📊 [${executor}] Metrics recorded: ${total} requests (place=${place_order}, cancel=${cancel_order}, modify=${modify_order}, cancelAll=${cancel_all})`);

    res.json({
      status: 'ok',
      timestamp,
      executor,
      total_requests: total,
    });
  } catch (error) {
    console.error('Error recording metrics:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/metrics/requests/summary
 * Get aggregated request metrics
 *
 * Query params:
 * - hours: Time window (default: 24)
 * - executor: Filter by executor (optional)
 */
app.get('/api/metrics/requests/summary', async (req: Request, res: Response) => {
  const hours = parseFloat(req.query.hours as string) || 24;
  const executor = req.query.executor as string;

  try {
    const cutoffTime = Date.now() - (hours * 60 * 60 * 1000);

    let query = `
      SELECT
        executor,
        COUNT(*) as report_count,
        SUM(place_order) as total_place,
        SUM(cancel_order) as total_cancel,
        SUM(modify_order) as total_modify,
        SUM(cancel_all) as total_cancel_all,
        SUM(place_order + cancel_order + modify_order + cancel_all) as total_requests,
        AVG(interval_ms) as avg_interval_ms,
        MIN(timestamp) as first_report,
        MAX(timestamp) as last_report
      FROM request_metrics
      WHERE timestamp >= ?
    `;

    const params: any[] = [cutoffTime];

    if (executor) {
      query += ' AND executor = ?';
      params.push(executor);
    }

    query += ' GROUP BY executor ORDER BY total_requests DESC';

    const [rows] = await pool.execute<any[]>(query, params);

    // Calculate per-minute rates
    const summary = rows.map((row) => {
      const durationMs = row.last_report - row.first_report;
      const durationMinutes = Math.max(durationMs / 60000, 1); // At least 1 minute

      return {
        executor: row.executor,
        report_count: parseInt(row.report_count),
        total_requests: parseInt(row.total_requests),
        breakdown: {
          place_order: parseInt(row.total_place),
          cancel_order: parseInt(row.total_cancel),
          modify_order: parseInt(row.total_modify),
          cancel_all: parseInt(row.total_cancel_all),
        },
        rates: {
          requests_per_minute: parseFloat((row.total_requests / durationMinutes).toFixed(2)),
          place_per_minute: parseFloat((row.total_place / durationMinutes).toFixed(2)),
          cancel_per_minute: parseFloat((row.total_cancel / durationMinutes).toFixed(2)),
          modify_per_minute: parseFloat((row.total_modify / durationMinutes).toFixed(2)),
        },
        first_report: row.first_report,
        last_report: row.last_report,
        duration_minutes: parseFloat(durationMinutes.toFixed(1)),
      };
    });

    // Calculate totals across all executors
    const totals = {
      total_requests: summary.reduce((sum, s) => sum + s.total_requests, 0),
      place_order: summary.reduce((sum, s) => sum + s.breakdown.place_order, 0),
      cancel_order: summary.reduce((sum, s) => sum + s.breakdown.cancel_order, 0),
      modify_order: summary.reduce((sum, s) => sum + s.breakdown.modify_order, 0),
      cancel_all: summary.reduce((sum, s) => sum + s.breakdown.cancel_all, 0),
    };

    res.json({
      hours,
      executor_count: summary.length,
      totals,
      executors: summary,
    });
  } catch (error) {
    console.error('Error fetching metrics summary:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/metrics/requests/timeseries
 * Get request metrics over time for charting
 *
 * Query params:
 * - hours: Time window (default: 24)
 * - executor: Filter by executor (optional)
 * - bucket: Aggregation bucket in minutes (default: 5)
 */
app.get('/api/metrics/requests/timeseries', async (req: Request, res: Response) => {
  const hours = parseFloat(req.query.hours as string) || 24;
  const executor = req.query.executor as string;
  const bucketMinutes = parseInt(req.query.bucket as string) || 5;

  try {
    const cutoffTime = Date.now() - (hours * 60 * 60 * 1000);
    const bucketMs = bucketMinutes * 60 * 1000;

    let query = `
      SELECT
        FLOOR(timestamp / ?) * ? as bucket_timestamp,
        executor,
        SUM(place_order) as place_order,
        SUM(cancel_order) as cancel_order,
        SUM(modify_order) as modify_order,
        SUM(cancel_all) as cancel_all,
        SUM(place_order + cancel_order + modify_order + cancel_all) as total
      FROM request_metrics
      WHERE timestamp >= ?
    `;

    const params: any[] = [bucketMs, bucketMs, cutoffTime];

    if (executor) {
      query += ' AND executor = ?';
      params.push(executor);
    }

    query += ' GROUP BY bucket_timestamp, executor ORDER BY bucket_timestamp ASC';

    const [rows] = await pool.execute<any[]>(query, params);

    res.json({
      hours,
      bucket_minutes: bucketMinutes,
      data_points: rows.length,
      timeseries: rows.map((row) => ({
        timestamp: parseInt(row.bucket_timestamp),
        executor: row.executor,
        place_order: parseInt(row.place_order),
        cancel_order: parseInt(row.cancel_order),
        modify_order: parseInt(row.modify_order),
        cancel_all: parseInt(row.cancel_all),
        total: parseInt(row.total),
      })),
    });
  } catch (error) {
    console.error('Error fetching metrics timeseries:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================================
// HEALTH ENDPOINT
// ============================================================================

/**
 * GET /api/health
 * Health check endpoint
 */
app.get('/api/health', async (_req: Request, res: Response) => {
  try {
    await pool.execute('SELECT 1');
    res.json({ status: 'ok', timestamp: Date.now() });
  } catch (error) {
    res.status(500).json({ status: 'error', error: 'Database unavailable' });
  }
});

// ============================================================================
// BTC IMPLIED VOLATILITY (from Deribit Options)
// ============================================================================

// Cache IV data (refresh every 5 minutes)
let cachedIVData: DeribitIVData | null = null;
let ivCacheTime = 0;
const IV_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * GET /api/btc-iv
 * Returns BTC implied volatility from Deribit options market
 *
 * Use this to detect elevated market risk from:
 * - Fed announcements
 * - CPI releases
 * - Geopolitical events
 * - Any market-moving events
 *
 * Response includes:
 * - dvol: 30-day implied volatility (like VIX)
 * - short_term_iv: Nearest expiry ATM IV
 * - one_day_iv: ~1 day expiry ATM IV
 * - elevated_risk: Boolean flag for high-risk conditions
 * - expected_daily_move_pct: Expected % move based on IV
 */
app.get('/api/btc-iv', async (_req: Request, res: Response) => {
  try {
    const now = Date.now();

    // Return cached data if fresh
    if (cachedIVData && (now - ivCacheTime) < IV_CACHE_TTL_MS) {
      res.json({
        ...cachedIVData,
        cached: true,
        cache_age_seconds: Math.round((now - ivCacheTime) / 1000)
      });
      return;
    }

    // Fetch fresh data
    const ivData = await fetchDeribitIV();
    cachedIVData = ivData;
    ivCacheTime = now;

    res.json({
      ...ivData,
      cached: false,
      cache_age_seconds: 0
    });
  } catch (error) {
    console.error('Error fetching BTC IV:', error);
    res.status(500).json({
      error: 'Failed to fetch IV data',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/btc-iv/should-trade
 * Simple endpoint that returns whether to trade based on IV conditions
 *
 * Returns:
 * - should_trade: boolean
 * - reason: explanation
 * - iv_data: summary metrics
 */
app.get('/api/btc-iv/should-trade', async (_req: Request, res: Response) => {
  try {
    const now = Date.now();

    // Use cache if available
    let ivData: DeribitIVData;
    if (cachedIVData && (now - ivCacheTime) < IV_CACHE_TTL_MS) {
      ivData = cachedIVData;
    } else {
      ivData = await fetchDeribitIV();
      cachedIVData = ivData;
      ivCacheTime = now;
    }

    const shouldTrade = !ivData.elevated_risk;

    res.json({
      should_trade: shouldTrade,
      reason: ivData.elevated_risk
        ? ivData.risk_reason
        : 'IV conditions normal',
      iv_data: {
        dvol: ivData.dvol,
        short_term_iv: ivData.short_term_iv,
        expected_daily_move_pct: ivData.expected_daily_move_pct,
        term_structure: ivData.iv_term_structure
      }
    });
  } catch (error) {
    console.error('Error checking IV conditions:', error);
    // Default to not trading if we can't check IV
    res.json({
      should_trade: false,
      reason: 'Unable to fetch IV data - defaulting to safe mode',
      iv_data: null
    });
  }
});

/**
 * GET /api/btc-iv/history?hours=24
 * Returns historical IV data for analysis
 *
 * Query params:
 * - hours: Number of hours to look back (default: 24, max: 168)
 */
app.get('/api/btc-iv/history', async (req: Request, res: Response) => {
  try {
    const hours = Math.min(parseInt(req.query.hours as string) || 24, 168);
    const cutoffTime = Date.now() - (hours * 60 * 60 * 1000);

    const [rows] = await pool.execute<any[]>(
      `SELECT
        timestamp,
        btc_price,
        dvol,
        short_term_iv,
        one_day_iv,
        iv_term_structure,
        expected_daily_move_pct,
        elevated_risk,
        risk_reason
      FROM btc_implied_volatility
      WHERE timestamp >= ?
      ORDER BY timestamp DESC`,
      [cutoffTime]
    );

    // Calculate summary stats
    const dvols = rows.map(r => parseFloat(r.dvol));
    const shortIVs = rows.map(r => parseFloat(r.short_term_iv));

    res.json({
      hours,
      sample_count: rows.length,
      summary: {
        dvol: {
          current: dvols[0] || 0,
          avg: dvols.length > 0 ? dvols.reduce((a, b) => a + b, 0) / dvols.length : 0,
          min: Math.min(...dvols) || 0,
          max: Math.max(...dvols) || 0
        },
        short_term_iv: {
          current: shortIVs[0] || 0,
          avg: shortIVs.length > 0 ? shortIVs.reduce((a, b) => a + b, 0) / shortIVs.length : 0,
          min: Math.min(...shortIVs) || 0,
          max: Math.max(...shortIVs) || 0
        },
        elevated_risk_periods: rows.filter(r => r.elevated_risk).length
      },
      data: rows.slice(0, 100)  // Limit to 100 most recent for response size
    });
  } catch (error) {
    console.error('Error fetching IV history:', error);
    res.status(500).json({ error: 'Failed to fetch IV history' });
  }
});

/**
 * GET /api/btc-iv/hourly?hours=24
 * Returns hourly aggregated IV data for longer-term analysis
 */
app.get('/api/btc-iv/hourly', async (req: Request, res: Response) => {
  try {
    const hours = Math.min(parseInt(req.query.hours as string) || 24, 720);
    const cutoffTime = Date.now() - (hours * 60 * 60 * 1000);

    const [rows] = await pool.execute<any[]>(
      `SELECT
        hour_timestamp,
        avg_dvol,
        min_dvol,
        max_dvol,
        avg_short_term_iv,
        min_short_term_iv,
        max_short_term_iv,
        avg_expected_daily_move,
        elevated_risk_count,
        sample_count,
        btc_price_open,
        btc_price_close,
        btc_price_high,
        btc_price_low
      FROM btc_iv_hourly
      WHERE hour_timestamp >= ?
      ORDER BY hour_timestamp DESC`,
      [cutoffTime]
    );

    res.json({
      hours,
      data: rows
    });
  } catch (error) {
    console.error('Error fetching hourly IV:', error);
    res.status(500).json({ error: 'Failed to fetch hourly IV data' });
  }
});

const PORT = process.env.API_PORT || 3001;

export function startAPI() {
  app.listen(PORT, () => {
    console.log(`📡 Spread API listening on port ${PORT}`);
    console.log(`   Spread Endpoints:`);
    console.log(`   GET /api/market/snapshot`);
    console.log(`   GET /api/volatility/:pair?window=10`);
    console.log(`   GET /api/spread/:pair/current`);
    console.log(`   GET /api/spread/:pair/average?hours=1`);
    console.log(`   GET /api/spread/:pair/opportunity?threshold=1.5`);
    console.log(`   GET /api/pairs/active`);
    console.log(`   `);
    console.log(`   BTC Implied Volatility (Deribit Options):`);
    console.log(`   GET /api/btc-iv`);
    console.log(`   GET /api/btc-iv/should-trade`);
    console.log(`   `);
    console.log(`   Trade Size Endpoints (Position Sizing):`);
    console.log(`   GET /api/trades/:pair/recent?limit=100&hours=24`);
    console.log(`   GET /api/trades/:pair/size-stats?hours=1&percentiles=25,50,75`);
    console.log(`   GET /api/trades/:pair/recommended-size?percentile=25`);
    console.log(`   GET /api/trades/:pair/volume?minutes=5`);
    console.log(`   GET /api/trades/pairs`);
    console.log(`   `);
    console.log(`   Metrics Endpoints (API Usage Tracking):`);
    console.log(`   POST /api/metrics/requests`);
    console.log(`   GET  /api/metrics/requests/summary?hours=24`);
    console.log(`   GET  /api/metrics/requests/timeseries?hours=24&bucket=5`);
    console.log(`   `);
    console.log(`   GET /api/health`);
  });
}

// If run directly (not imported)
if (import.meta.url === `file://${process.argv[1]}`) {
  startAPI();
}
