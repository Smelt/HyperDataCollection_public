-- Migration: Create pair_candles_1h for per-pair hourly OHLCV
-- Version: 011
-- Created: 2026-05-13
-- Description: Stores hourly candle data fetched from Hyperliquid's candleSnapshot
-- endpoint for every tracked pair (including HIP-3 prefixed pairs like vntl:OPENAI,
-- xyz:DKNG). Used to surface volume-per-time-window in Grafana so we can compare
-- realized volume vs. spread and identify liquid + wide-spread pairs.

CREATE TABLE IF NOT EXISTS pair_candles_1h (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  timestamp BIGINT NOT NULL COMMENT 'Hour-bucket start (Unix ms, UTC)',
  pair VARCHAR(40) NOT NULL COMMENT 'Trading pair (e.g., BTC, vntl:OPENAI, xyz:DKNG)',

  open_price DECIMAL(20, 10) NOT NULL,
  high_price DECIMAL(20, 10) NOT NULL,
  low_price DECIMAL(20, 10) NOT NULL,
  close_price DECIMAL(20, 10) NOT NULL,

  volume_base DECIMAL(28, 8) NOT NULL COMMENT 'Volume in base asset',
  volume_usd DECIMAL(20, 4) NOT NULL COMMENT 'Volume in USD (volume_base * avg price)',
  trade_count INT NOT NULL DEFAULT 0 COMMENT 'Number of trades in the hour',

  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uk_pair_hour (pair, timestamp),
  INDEX idx_timestamp (timestamp),
  INDEX idx_pair_timestamp (pair, timestamp)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Hourly OHLCV candles per pair from Hyperliquid candleSnapshot';

INSERT INTO schema_migrations (version, name)
VALUES (11, 'create_pair_candles_1h')
ON DUPLICATE KEY UPDATE name = name;
