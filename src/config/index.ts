import dotenv from 'dotenv';
import { Config } from '../types/index.js';
import { getEnabledPairs } from './pairs.js';

dotenv.config();

export function loadConfig(): Config {
  const pairs = process.env.PAIRS
    ? process.env.PAIRS.split(',').map(p => p.trim())
    : getEnabledPairs();

  return {
    hyperliquidApiUrl: process.env.HYPERLIQUID_API_URL || 'https://api.hyperliquid.xyz',
    hyperliquidWsUrl: process.env.HYPERLIQUID_WS_URL || 'wss://api.hyperliquid.xyz/ws',
    snapshotIntervalMs: parseInt(process.env.SNAPSHOT_INTERVAL_MS || '1000', 10),
    pairs,
    logLevel: process.env.LOG_LEVEL || 'info',
    dataDir: process.env.DATA_DIR || './data',
    enableCsvLogging: process.env.ENABLE_CSV_LOGGING !== 'false',
    enableJsonSummary: process.env.ENABLE_JSON_SUMMARY !== 'false',
    makerFeeBps: parseFloat(process.env.MAKER_FEE_BPS || '1.5'),
    takerFeeBps: parseFloat(process.env.TAKER_FEE_BPS || '4.5'),
  };
}

export const config = loadConfig();
