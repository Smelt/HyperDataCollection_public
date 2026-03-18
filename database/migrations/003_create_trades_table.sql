-- Migration: Create user_trades table for Hyperliquid user trades
-- Purpose: Store all trade fills from Hyperliquid API

CREATE TABLE IF NOT EXISTS user_trades (
    tid BIGINT PRIMARY KEY,
    time BIGINT NOT NULL,
    coin VARCHAR(50) NOT NULL,
    side CHAR(1) NOT NULL,
    px DECIMAL(20, 10) NOT NULL,
    sz DECIMAL(20, 10) NOT NULL,
    dir VARCHAR(50) NOT NULL,
    closed_pnl DECIMAL(20, 10),
    fee DECIMAL(20, 10) NOT NULL,
    oid BIGINT NOT NULL,
    start_position DECIMAL(20, 10),
    crossed BOOLEAN NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_time (time),
    INDEX idx_coin (coin),
    INDEX idx_time_coin (time, coin)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Add comments for documentation
ALTER TABLE user_trades
    MODIFY COLUMN tid BIGINT COMMENT 'Trade ID (unique identifier from Hyperliquid)',
    MODIFY COLUMN time BIGINT COMMENT 'Timestamp in milliseconds',
    MODIFY COLUMN coin VARCHAR(50) COMMENT 'Asset/pair (e.g., BTC, ETH)',
    MODIFY COLUMN side CHAR(1) COMMENT 'B (buy) or A (ask/sell)',
    MODIFY COLUMN px DECIMAL(20, 10) COMMENT 'Execution price',
    MODIFY COLUMN sz DECIMAL(20, 10) COMMENT 'Fill size (quantity)',
    MODIFY COLUMN dir VARCHAR(50) COMMENT 'Direction (e.g., Open Long, Close Short)',
    MODIFY COLUMN closed_pnl DECIMAL(20, 10) COMMENT 'Realized P&L from this fill',
    MODIFY COLUMN fee DECIMAL(20, 10) COMMENT 'Total fee charged',
    MODIFY COLUMN oid BIGINT COMMENT 'Order ID',
    MODIFY COLUMN start_position DECIMAL(20, 10) COMMENT 'Position size before this fill',
    MODIFY COLUMN crossed BOOLEAN COMMENT 'Whether order crossed the book (taker=true, maker=false)';
