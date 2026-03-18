// Order Book Types
export interface OrderBookLevel {
  px: string;  // price
  sz: string;  // size
  n: number;   // number of orders
}

export interface L2OrderBook {
  coin: string;
  time: number;
  levels: [OrderBookLevel[], OrderBookLevel[]]; // [bids, asks]
}

// Spread Data Types
export interface SpreadData {
  timestamp: number;
  pair: string;
  bestBid: number;
  bestAsk: number;
  bidSize: number;
  askSize: number;
  spread: number;
  spreadBps: number;
  spreadPct: number;
  midPrice: number;
  imbalance: number; // (bidSize - askSize) / (bidSize + askSize)
}

// Statistics Types
export interface SpreadStats {
  pair: string;
  count: number;
  avgSpread: number;
  minSpread: number;
  maxSpread: number;
  stdDev: number;
  avgSpread5m: number;
  avgSpread1h: number;
  lastUpdate: number;
}

// Market Making Opportunity Types
export interface MarketMakingOpportunity {
  pair: string;
  avgSpread: number;
  avgVolume: number;
  consistency: number; // stdDev / avgSpread (lower is better)
  profitability: number; // avgSpread - (2 * makerFee)
  rank: number;
}

// Configuration Types
export interface PairConfig {
  symbol: string;
  minSpread: number;  // Minimum spread to consider "good"
  targetVolume: number; // Minimum daily volume
  enabled: boolean;
}

export interface Config {
  hyperliquidApiUrl: string;
  hyperliquidWsUrl: string;
  snapshotIntervalMs: number;
  pairs: string[];
  logLevel: string;
  dataDir: string;
  enableCsvLogging: boolean;
  enableJsonSummary: boolean;
  makerFeeBps: number;
  takerFeeBps: number;
}

// API Response Types
export interface HyperliquidMetaResponse {
  universe: Array<{
    name: string;
    szDecimals: number;
  }>;
}

export interface HyperliquidAssetContext {
  coin: string;
  dayNtlVlm: string; // 24h volume
  funding: string;
  openInterest: string;
  prevDayPx: string;
  markPx: string;
}

export interface HyperliquidMetaAndAssetCtxsResponse {
  meta: HyperliquidMetaResponse;
  assetCtxs: HyperliquidAssetContext[];
}

// WebSocket Types
export interface WebSocketSubscription {
  method: string;
  subscription: {
    type: string;
    coin: string;
  };
}

export interface WebSocketMessage {
  channel: string;
  data: L2OrderBook;
}

// Logger Types
export interface CSVLogEntry {
  timestamp: string;
  pair: string;
  best_bid: number;
  best_ask: number;
  bid_size: number;
  ask_size: number;
  spread_bps: number;
  spread_pct: number;
  mid_price: number;
  book_imbalance: number;
}

// Dashboard Types
export interface DashboardData {
  startTime: Date;
  dataPointsCollected: number;
  pairStats: Map<string, SpreadStats>;
  opportunities: MarketMakingOpportunity[];
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

// Database Types
export interface SpreadSnapshot {
  id?: number;
  timestamp: number;
  pair: string;
  bestBid: number;
  bestAsk: number;
  spreadPct: number;
  spreadBps: number;
  bidSize: number;
  askSize: number;
  midPrice: number;
  imbalance: number;
}

export interface HourlyStats {
  id?: number;
  hourTimestamp: number;
  pair: string;
  avgSpread: number;
  minSpread: number;
  maxSpread: number;
  stdDev: number;
  medianSpread: number;
  sampleCount: number;
  avgVolume: number;
}

export interface TradingSignal {
  id?: number;
  timestamp: number;
  pair: string;
  signalType: 'ENTER' | 'EXIT' | 'HOLD';
  currentSpread: number;
  avgSpread1h: number;
  avgSpread24h?: number;
  threshold?: number;
  confidence?: number;
  expectedProfit?: number;
  reasoning?: string;
}
