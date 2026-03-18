-- Migration: Add request_metrics table for API usage tracking
-- Created: 2026-01-11

CREATE TABLE IF NOT EXISTS request_metrics (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  timestamp BIGINT NOT NULL,              -- Unix ms when metrics were recorded
  executor VARCHAR(50) NOT NULL,          -- Executor identifier (e.g., 'MON', 'FOGO')

  -- Request counts since last report
  place_order INT NOT NULL DEFAULT 0,
  cancel_order INT NOT NULL DEFAULT 0,
  modify_order INT NOT NULL DEFAULT 0,
  cancel_all INT NOT NULL DEFAULT 0,

  -- Reporting interval
  interval_ms INT NOT NULL DEFAULT 60000, -- How often metrics are reported (default 60s)

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_timestamp (timestamp),
  INDEX idx_executor (executor),
  INDEX idx_executor_timestamp (executor, timestamp)
);

-- Add to schema_migrations tracking
INSERT INTO schema_migrations (version, name, applied_at)
VALUES (3, 'request_metrics', NOW())
ON DUPLICATE KEY UPDATE applied_at = NOW();
