-- Migration: Create btc_implied_volatility table
-- Purpose: Store BTC implied volatility from Deribit options
-- Use case: Detect market events (Fed, CPI, geopolitical) for trading filters
-- Polling: Every 5 minutes (~288 rows/day)
-- Retention: Permanent (small data volume, valuable for historical analysis)

CREATE TABLE IF NOT EXISTS btc_implied_volatility (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,

  -- Timestamp
  timestamp BIGINT NOT NULL COMMENT 'Collection timestamp (ms since epoch)',

  -- BTC Price at collection time
  btc_price DECIMAL(12,2) NOT NULL COMMENT 'BTC spot price in USD',

  -- Core IV metrics
  dvol DECIMAL(6,2) NOT NULL COMMENT 'DVOL 30-day implied volatility (%)',
  short_term_iv DECIMAL(6,2) NOT NULL COMMENT 'Nearest expiry ATM IV (%)',
  short_term_expiry_hours DECIMAL(6,2) NOT NULL COMMENT 'Hours until nearest expiry',
  one_day_iv DECIMAL(6,2) COMMENT '~1 day expiry ATM IV (%) - nullable if no 1d expiry',

  -- Derived metrics
  iv_term_structure ENUM('contango', 'backwardation', 'flat') NOT NULL COMMENT 'Short vs long term IV relationship',
  expected_daily_move_pct DECIMAL(5,2) NOT NULL COMMENT 'Expected daily price move based on IV (%)',

  -- Risk signal
  elevated_risk BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'True if market conditions are high-risk',
  risk_reason VARCHAR(255) COMMENT 'Explanation if elevated_risk is true',

  -- Metadata
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  -- Indexes for efficient queries
  INDEX idx_timestamp (timestamp),
  INDEX idx_elevated_risk (elevated_risk, timestamp),
  INDEX idx_dvol (dvol),

  -- Unique constraint to prevent duplicate entries
  UNIQUE KEY uk_timestamp (timestamp)

) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='BTC implied volatility from Deribit options (5-min intervals)';

-- Create hourly aggregates table for efficient long-term queries
CREATE TABLE IF NOT EXISTS btc_iv_hourly (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,

  -- Hour bucket
  hour_timestamp BIGINT NOT NULL COMMENT 'Start of hour (ms since epoch)',

  -- Aggregated metrics
  avg_dvol DECIMAL(6,2) NOT NULL,
  min_dvol DECIMAL(6,2) NOT NULL,
  max_dvol DECIMAL(6,2) NOT NULL,

  avg_short_term_iv DECIMAL(6,2) NOT NULL,
  min_short_term_iv DECIMAL(6,2) NOT NULL,
  max_short_term_iv DECIMAL(6,2) NOT NULL,

  avg_expected_daily_move DECIMAL(5,2) NOT NULL,

  -- Risk summary
  elevated_risk_count INT NOT NULL DEFAULT 0 COMMENT 'Number of 5-min periods with elevated risk',
  sample_count INT NOT NULL COMMENT 'Number of samples in this hour',

  -- BTC price range
  btc_price_open DECIMAL(12,2) NOT NULL,
  btc_price_close DECIMAL(12,2) NOT NULL,
  btc_price_high DECIMAL(12,2) NOT NULL,
  btc_price_low DECIMAL(12,2) NOT NULL,

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  UNIQUE KEY uk_hour (hour_timestamp),
  INDEX idx_hour (hour_timestamp)

) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Hourly aggregates of BTC IV data for long-term analysis';
