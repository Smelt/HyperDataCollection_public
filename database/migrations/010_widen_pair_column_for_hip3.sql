-- Migration: Widen pair column for HIP-3 support
-- Version: 010
-- Created: 2026-03-01
-- Description: Widen pair column from VARCHAR(20) to VARCHAR(40) to support HIP-3 dex-prefixed names
-- e.g., "vntl:OPENAI", "xyz:TSLA", "vntl:ANTHROPIC"

ALTER TABLE spread_snapshots_partitioned MODIFY COLUMN pair VARCHAR(40) NOT NULL COMMENT 'Trading pair symbol (e.g., BTC, vntl:OPENAI)';
ALTER TABLE spread_stats_hourly MODIFY COLUMN pair VARCHAR(40) NOT NULL;
ALTER TABLE spread_snapshots_1min MODIFY COLUMN pair VARCHAR(40) NOT NULL;
ALTER TABLE trades MODIFY COLUMN pair VARCHAR(40) NOT NULL COMMENT 'Trading pair (e.g., BTC, vntl:OPENAI)';
ALTER TABLE trade_sizes MODIFY COLUMN pair VARCHAR(40) NOT NULL COMMENT 'Trading pair (e.g., MON, vntl:OPENAI)';
ALTER TABLE trading_signals MODIFY COLUMN pair VARCHAR(40) NOT NULL;
ALTER TABLE bot_trades MODIFY COLUMN pair VARCHAR(40) NOT NULL;
ALTER TABLE market_metrics MODIFY COLUMN pair VARCHAR(40) NOT NULL;

INSERT INTO schema_migrations (version, name)
VALUES (10, 'widen_pair_column_for_hip3')
ON DUPLICATE KEY UPDATE name = name;
