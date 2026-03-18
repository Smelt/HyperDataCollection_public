-- Migration: Create bot_trades and market_metrics tables
-- Version: 006
-- Created: 2025-11-16
-- Description: Tables for tracking bot trades with entry conditions and real-time market metrics
--
-- Rollback Instructions:
-- DROP TABLE IF EXISTS market_metrics;
-- DROP TABLE IF EXISTS bot_trades;

-- ============================================================================
-- 1. Bot Trades - Complete trade lifecycle with entry conditions
-- ============================================================================

CREATE TABLE IF NOT EXISTS bot_trades (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  trade_id VARCHAR(50) NOT NULL UNIQUE COMMENT 'Unique trade identifier (UUID)',

  -- Trade Basic Info
  pair VARCHAR(20) NOT NULL COMMENT 'Trading pair (e.g., MON, HMSTR)',
  side ENUM('LONG', 'SHORT') NOT NULL COMMENT 'Position direction',
  status ENUM('ENTERING', 'OPEN', 'EXITING', 'COMPLETED', 'ABORTED') NOT NULL COMMENT 'Trade lifecycle status',

  -- Timestamps
  entry_time BIGINT NOT NULL COMMENT 'When entry order was placed (Unix ms)',
  entry_fill_time BIGINT COMMENT 'When entry order filled (Unix ms)',
  exit_time BIGINT COMMENT 'When exit order was placed (Unix ms)',
  exit_fill_time BIGINT COMMENT 'When exit order filled (Unix ms)',
  hold_time_ms INT COMMENT 'Total hold time from entry fill to exit fill',

  -- Prices & Sizes
  entry_price DECIMAL(20, 10) COMMENT 'Entry fill price',
  exit_price DECIMAL(20, 10) COMMENT 'Exit fill price',
  size_coins DECIMAL(20, 10) COMMENT 'Position size in coins',
  size_usd DECIMAL(20, 4) COMMENT 'Position size in USD',

  -- P&L
  pnl_usd DECIMAL(20, 6) COMMENT 'Profit/Loss in USD',
  pnl_bps DECIMAL(10, 2) COMMENT 'Profit/Loss in basis points',
  fees_usd DECIMAL(20, 6) COMMENT 'Total fees paid',
  net_pnl_usd DECIMAL(20, 6) COMMENT 'Net P&L after fees',

  -- Entry Conditions (Market State When Trade Was Entered)
  entry_spread_bps DECIMAL(10, 2) COMMENT 'Spread when entered (bps)',
  entry_spread_threshold DECIMAL(10, 2) COMMENT 'Spread threshold used (P75/P90 value)',
  entry_threshold_type VARCHAR(10) COMMENT 'Threshold type (P75, P90, etc.)',
  entry_spread_multiplier DECIMAL(5, 2) COMMENT 'Multiplier applied to threshold',

  -- Order Book State at Entry
  entry_orderbook_imbalance DECIMAL(5, 4) COMMENT 'Bid/Ask depth ratio (0-1, 0.5=balanced)',
  entry_bid_depth_20bps DECIMAL(20, 4) COMMENT 'Bid depth within 20 bps of mid',
  entry_ask_depth_20bps DECIMAL(20, 4) COMMENT 'Ask depth within 20 bps of mid',
  entry_total_depth_usd DECIMAL(20, 4) COMMENT 'Total depth (bid + ask) in USD',

  -- Price Momentum at Entry
  entry_price_trend ENUM('UP', 'DOWN', 'SIDEWAYS') COMMENT 'Price trend detected at entry',
  entry_trend_strength DECIMAL(5, 4) COMMENT 'Trend strength (0-1, 1=strong trend)',
  entry_mid_price DECIMAL(20, 10) COMMENT 'Mid price at entry',
  entry_price_volatility_bps DECIMAL(10, 2) COMMENT 'Recent price volatility (bps)',

  -- Spread Behavior at Entry
  entry_spread_cycling BOOLEAN COMMENT 'Was spread cycling (mean-reverting)?',
  entry_spread_stuck_wide BOOLEAN COMMENT 'Was spread stuck wide (liquidity crisis)?',
  entry_avg_spread_10samples DECIMAL(10, 2) COMMENT 'Average spread from last 10 samples',

  -- Market Context at Entry
  entry_btc_volatility_bps DECIMAL(10, 2) COMMENT 'BTC 1-min volatility at entry (bps)',
  entry_volume_rate DECIMAL(20, 4) COMMENT 'Recent volume rate (USD/sec)',
  entry_recent_large_trades BOOLEAN COMMENT 'Were there recent large trades?',

  -- Filter Results (What filters said at entry)
  passed_imbalance_filter BOOLEAN COMMENT 'Did pass orderbook imbalance filter?',
  passed_trend_filter BOOLEAN COMMENT 'Did pass trend filter?',
  passed_spread_filter BOOLEAN COMMENT 'Did pass spread cycling filter?',
  passed_exit_liquidity_filter BOOLEAN COMMENT 'Did pass exit liquidity check?',
  passed_volatility_filter BOOLEAN COMMENT 'Did pass volatility filter?',

  -- Exit Conditions
  exit_reason ENUM('FILLED', 'TIMEOUT', 'SPREAD_COMPRESSED', 'FORCED', 'MANUAL') COMMENT 'Why trade was exited',
  exit_spread_bps DECIMAL(10, 2) COMMENT 'Spread when exited',

  -- Predictions vs Reality
  predicted_exit_time_sec INT COMMENT 'Predicted exit time based on liquidity',
  actual_exit_time_sec INT COMMENT 'Actual time to exit',
  exit_prediction_accurate BOOLEAN COMMENT 'Was exit time prediction accurate?',

  -- Order IDs for tracking
  entry_order_id VARCHAR(50) COMMENT 'Hyperliquid entry order ID',
  exit_order_id VARCHAR(50) COMMENT 'Hyperliquid exit order ID',

  -- Metadata
  bot_version VARCHAR(20) COMMENT 'Bot version identifier',
  notes TEXT COMMENT 'Additional notes or debugging info',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  -- Indexes for analysis
  INDEX idx_pair (pair),
  INDEX idx_entry_time (entry_time),
  INDEX idx_status (status),
  INDEX idx_pair_status (pair, status),
  INDEX idx_hold_time (hold_time_ms),
  INDEX idx_pnl (pnl_bps),
  INDEX idx_profitable (pnl_bps) USING BTREE,
  INDEX idx_entry_conditions (passed_imbalance_filter, passed_trend_filter, passed_spread_filter),
  INDEX idx_trend (entry_price_trend, entry_trend_strength)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  COMMENT='Bot trades with complete entry conditions for analysis';

-- ============================================================================
-- 2. Market Metrics - Real-time market state snapshots
-- ============================================================================

CREATE TABLE IF NOT EXISTS market_metrics (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  timestamp BIGINT NOT NULL COMMENT 'Unix timestamp in milliseconds',
  pair VARCHAR(20) NOT NULL COMMENT 'Trading pair',

  -- Current Prices & Spread
  best_bid DECIMAL(20, 10) NOT NULL,
  best_ask DECIMAL(20, 10) NOT NULL,
  mid_price DECIMAL(20, 10) NOT NULL,
  spread_bps DECIMAL(10, 2) NOT NULL,

  -- Order Book Depth
  orderbook_imbalance DECIMAL(5, 4) COMMENT 'Bid depth / Total depth (0-1)',
  bid_depth_20bps DECIMAL(20, 4) COMMENT 'Bid depth within 20 bps',
  ask_depth_20bps DECIMAL(20, 4) COMMENT 'Ask depth within 20 bps',
  total_depth_usd DECIMAL(20, 4) COMMENT 'Total depth in USD',

  -- Price Momentum
  price_trend ENUM('UP', 'DOWN', 'SIDEWAYS'),
  trend_strength DECIMAL(5, 4),
  price_volatility_bps DECIMAL(10, 2),

  -- Spread Behavior
  spread_cycling BOOLEAN,
  spread_stuck_wide BOOLEAN,
  spread_avg_10samples DECIMAL(10, 2),
  spread_crossings_10samples INT COMMENT 'How many times spread crossed average',

  -- BTC Context (if available)
  btc_mid_price DECIMAL(20, 10),
  btc_volatility_bps DECIMAL(10, 2),

  -- Volume & Flow
  volume_rate_usd_per_sec DECIMAL(20, 4),
  recent_large_trade BOOLEAN,

  -- Filter Status (Would we trade right now?)
  tradeable BOOLEAN COMMENT 'Would filters allow trade?',
  failed_filters VARCHAR(200) COMMENT 'Comma-separated list of failed filters',

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  -- Indexes
  INDEX idx_pair_timestamp (pair, timestamp),
  INDEX idx_timestamp (timestamp),
  INDEX idx_tradeable (pair, tradeable, timestamp)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  COMMENT='Real-time market metrics captured every update (5-10s)';

-- ============================================================================
-- Track Migration
-- ============================================================================

INSERT INTO schema_migrations (version, name)
VALUES (6, 'create_bot_trades_and_metrics')
ON DUPLICATE KEY UPDATE name = name;
