-- Create trades table for storing Hyperliquid public trade data
-- Fetched via recentTrades API every 5 minutes

CREATE TABLE IF NOT EXISTS trades (
  -- Primary key
  id BIGINT AUTO_INCREMENT PRIMARY KEY,

  -- Trade identification (unique per trade)
  trade_id BIGINT NOT NULL COMMENT 'Trade ID from Hyperliquid',
  tx_hash VARCHAR(66) NOT NULL COMMENT 'Transaction hash (0x...)',

  -- Trade details
  pair VARCHAR(20) NOT NULL COMMENT 'Trading pair (e.g., BTC, ETH)',
  side ENUM('B', 'A') NOT NULL COMMENT 'B = Buy/Bid, A = Sell/Ask',
  price DECIMAL(20,10) NOT NULL COMMENT 'Trade execution price',
  size DECIMAL(20,8) NOT NULL COMMENT 'Trade size/quantity',
  timestamp BIGINT NOT NULL COMMENT 'Trade timestamp (ms since epoch)',

  -- Participants
  maker_address VARCHAR(42) NOT NULL COMMENT 'Maker wallet address',
  taker_address VARCHAR(42) NOT NULL COMMENT 'Taker wallet address',

  -- Metadata
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT 'When this record was inserted',

  -- Indexes for fast queries
  INDEX idx_pair (pair),
  INDEX idx_timestamp (timestamp),
  INDEX idx_pair_timestamp (pair, timestamp),
  INDEX idx_maker (maker_address),
  INDEX idx_taker (taker_address),

  -- Unique constraint: One record per trade
  UNIQUE KEY unique_trade (trade_id, tx_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Public trades from Hyperliquid DEX';
