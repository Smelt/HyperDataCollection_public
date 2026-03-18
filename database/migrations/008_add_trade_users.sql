-- Migration: Add buyer and seller addresses to trade_sizes
-- This enables reconstructing actual order sizes from multiple fills
-- and tracking specific wallet activity

-- Add buyer and seller columns
ALTER TABLE trade_sizes
ADD COLUMN buyer VARCHAR(42) DEFAULT NULL,
ADD COLUMN seller VARCHAR(42) DEFAULT NULL;

-- Add indexes for efficient lookups
CREATE INDEX idx_trade_sizes_buyer ON trade_sizes(buyer);
CREATE INDEX idx_trade_sizes_seller ON trade_sizes(seller);

-- Composite index for grouping trades by user within time windows
CREATE INDEX idx_trade_sizes_buyer_time ON trade_sizes(buyer, timestamp);
CREATE INDEX idx_trade_sizes_seller_time ON trade_sizes(seller, timestamp);

-- Record migration
INSERT INTO schema_migrations (version, name, applied_at)
VALUES (8, 'add_trade_users', NOW());
