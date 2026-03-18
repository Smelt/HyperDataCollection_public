-- Migration: Initial Database Schema
-- Version: 001
-- Created: 2025-10-19
-- Description: Creates the core tables for spread monitoring, statistics, and signals
--
-- Rollback Instructions:
-- DROP TABLE IF EXISTS trading_signals;
-- DROP TABLE IF EXISTS spread_stats_hourly;
-- DROP TABLE IF EXISTS spread_snapshots;
-- DROP TABLE IF EXISTS schema_migrations;

-- ============================================================================
-- 1. Schema Migrations Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_version (version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  COMMENT='Tracks applied database migrations';

-- ============================================================================
-- 2. Spread Snapshots - Raw Market Data
-- ============================================================================

CREATE TABLE IF NOT EXISTS spread_snapshots (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  timestamp BIGINT NOT NULL COMMENT 'Unix timestamp in milliseconds',
  pair VARCHAR(20) NOT NULL COMMENT 'Trading pair symbol (e.g., REZ, SOL)',
  best_bid DECIMAL(20, 10) NOT NULL COMMENT 'Best bid price',
  best_ask DECIMAL(20, 10) NOT NULL COMMENT 'Best ask price',
  spread_pct DECIMAL(10, 6) NOT NULL COMMENT 'Spread as percentage',
  spread_bps DECIMAL(10, 2) NOT NULL COMMENT 'Spread in basis points',
  bid_size DECIMAL(20, 4) COMMENT 'Size at best bid',
  ask_size DECIMAL(20, 4) COMMENT 'Size at best ask',
  mid_price DECIMAL(20, 10) COMMENT '(bid + ask) / 2',
  imbalance DECIMAL(5, 4) COMMENT 'Order book imbalance: (bid_size - ask_size) / (bid_size + ask_size)',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_pair_timestamp (pair, timestamp),
  INDEX idx_timestamp (timestamp),
  INDEX idx_pair (pair)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  COMMENT='Raw spread snapshots collected every 5 seconds';

-- ============================================================================
-- 3. Spread Statistics - Hourly Aggregates
-- ============================================================================

CREATE TABLE IF NOT EXISTS spread_stats_hourly (
  id INT AUTO_INCREMENT PRIMARY KEY,
  hour_timestamp BIGINT NOT NULL COMMENT 'Hour start timestamp (Unix ms)',
  pair VARCHAR(20) NOT NULL,
  avg_spread DECIMAL(10, 6) NOT NULL COMMENT 'Average spread for the hour',
  min_spread DECIMAL(10, 6) NOT NULL COMMENT 'Minimum spread seen',
  max_spread DECIMAL(10, 6) NOT NULL COMMENT 'Maximum spread seen',
  std_dev DECIMAL(10, 6) COMMENT 'Standard deviation of spread',
  median_spread DECIMAL(10, 6) COMMENT 'Median spread',
  sample_count INT NOT NULL COMMENT 'Number of snapshots in calculation',
  avg_volume DECIMAL(20, 4) COMMENT 'Average total volume (bid + ask)',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  UNIQUE KEY unique_pair_hour (pair, hour_timestamp),
  INDEX idx_pair (pair),
  INDEX idx_hour (hour_timestamp)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  COMMENT='Hourly aggregated spread statistics - permanent storage';

-- ============================================================================
-- 4. Trading Signals
-- ============================================================================

CREATE TABLE IF NOT EXISTS trading_signals (
  id INT AUTO_INCREMENT PRIMARY KEY,
  timestamp BIGINT NOT NULL COMMENT 'Signal generation time',
  pair VARCHAR(20) NOT NULL,
  signal_type ENUM('ENTER', 'EXIT', 'HOLD') NOT NULL,
  current_spread DECIMAL(10, 6) NOT NULL COMMENT 'Spread when signal generated',
  avg_spread_1h DECIMAL(10, 6) NOT NULL COMMENT '1-hour average spread',
  avg_spread_24h DECIMAL(10, 6) COMMENT '24-hour average spread',
  threshold DECIMAL(10, 6) COMMENT 'Entry threshold used',
  confidence DECIMAL(5, 2) COMMENT 'Signal confidence score (0-100)',
  expected_profit DECIMAL(10, 6) COMMENT 'Expected profit after fees',
  reasoning TEXT COMMENT 'Why signal was generated',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_pair_timestamp (pair, timestamp),
  INDEX idx_signal_type (signal_type),
  INDEX idx_pair_type (pair, signal_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  COMMENT='Trading signals for analysis and future execution';

-- ============================================================================
-- Track Migration
-- ============================================================================

INSERT INTO schema_migrations (version, name)
VALUES (1, 'initial_schema')
ON DUPLICATE KEY UPDATE name = name;
