-- Migration: Create trade_sizes table with auto-partitioning
-- Purpose: Track trade sizes for position sizing decisions
-- Retention: 7 days (managed via partition drops)

-- Drop existing table if exists (for clean migration)
DROP TABLE IF EXISTS trade_sizes;

-- Create partitioned table for trade sizes
-- Partitioned by day for efficient cleanup (DROP PARTITION vs DELETE)
CREATE TABLE trade_sizes (
  id BIGINT AUTO_INCREMENT,
  trade_id BIGINT NOT NULL COMMENT 'Trade ID from Hyperliquid (for dedup)',
  pair VARCHAR(20) NOT NULL COMMENT 'Trading pair (e.g., MON, HMSTR)',
  size DECIMAL(20,8) NOT NULL COMMENT 'Trade size in base asset',
  price DECIMAL(20,10) NOT NULL COMMENT 'Execution price',
  side ENUM('B', 'A') NOT NULL COMMENT 'B=Buy (taker bought), A=Ask (taker sold)',
  notional_usd DECIMAL(20,4) GENERATED ALWAYS AS (size * price) STORED COMMENT 'Trade value in USD',
  timestamp BIGINT NOT NULL COMMENT 'Trade timestamp (ms since epoch)',

  -- Primary key must include partition column
  PRIMARY KEY (id, timestamp),

  -- Unique constraint to prevent duplicate trades
  UNIQUE KEY uk_trade (trade_id, timestamp),

  -- Indexes for fast queries
  INDEX idx_pair_time (pair, timestamp),
  INDEX idx_pair_size (pair, size)

) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Trade sizes for position sizing (7-day retention, partitioned by day)'
PARTITION BY RANGE (timestamp) (
  -- Initial partitions for the next 14 days
  -- Partition management script will maintain rolling 7-day window
  PARTITION p20251229 VALUES LESS THAN (1735516800000),
  PARTITION p20251230 VALUES LESS THAN (1735603200000),
  PARTITION p20251231 VALUES LESS THAN (1735689600000),
  PARTITION p20260101 VALUES LESS THAN (1735776000000),
  PARTITION p20260102 VALUES LESS THAN (1735862400000),
  PARTITION p20260103 VALUES LESS THAN (1735948800000),
  PARTITION p20260104 VALUES LESS THAN (1736035200000),
  PARTITION p20260105 VALUES LESS THAN (1736121600000),
  PARTITION p20260106 VALUES LESS THAN (1736208000000),
  PARTITION p20260107 VALUES LESS THAN (1736294400000),
  PARTITION p20260108 VALUES LESS THAN (1736380800000),
  PARTITION p20260109 VALUES LESS THAN (1736467200000),
  PARTITION p20260110 VALUES LESS THAN (1736553600000),
  PARTITION p20260111 VALUES LESS THAN (1736640000000),
  PARTITION p_future VALUES LESS THAN MAXVALUE
);

-- Create a helper table to track partition management
CREATE TABLE IF NOT EXISTS partition_management (
  id INT AUTO_INCREMENT PRIMARY KEY,
  table_name VARCHAR(64) NOT NULL,
  last_partition_created DATE NOT NULL,
  last_partition_dropped DATE,
  retention_days INT NOT NULL DEFAULT 7,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_table (table_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Initialize partition management for trade_sizes
INSERT INTO partition_management (table_name, last_partition_created, retention_days)
VALUES ('trade_sizes', '2026-01-11', 7)
ON DUPLICATE KEY UPDATE last_partition_created = '2026-01-11';
