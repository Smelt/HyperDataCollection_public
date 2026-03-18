-- Create 1-minute aggregation table for spread snapshots
-- This stores min/max/avg price and spread data per minute per pair

CREATE TABLE IF NOT EXISTS spread_snapshots_1min (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,

  -- Time window (start of the 1-minute window, in milliseconds)
  timestamp BIGINT NOT NULL,

  -- Trading pair
  pair VARCHAR(20) NOT NULL,

  -- Price aggregations (based on mid_price)
  min_price DECIMAL(20,10) NOT NULL,
  max_price DECIMAL(20,10) NOT NULL,
  avg_price DECIMAL(20,10) NOT NULL,

  -- Spread aggregations (in basis points)
  min_spread_bps DECIMAL(10,2) NOT NULL,
  max_spread_bps DECIMAL(10,2) NOT NULL,
  avg_spread_bps DECIMAL(10,2) NOT NULL,

  -- Bid/Ask aggregations
  avg_bid DECIMAL(20,10) NOT NULL,
  avg_ask DECIMAL(20,10) NOT NULL,

  -- Volume indicators
  avg_bid_size DECIMAL(20,4),
  avg_ask_size DECIMAL(20,4),
  avg_imbalance DECIMAL(5,4),

  -- Statistics
  sample_count INT NOT NULL COMMENT 'Number of 5-second snapshots in this minute',

  -- Record metadata
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  -- Indexes for fast queries
  INDEX idx_timestamp (timestamp),
  INDEX idx_pair (pair),
  INDEX idx_pair_timestamp (pair, timestamp),
  UNIQUE KEY unique_pair_timestamp (pair, timestamp)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='1-minute aggregated spread data from 5-second snapshots';
