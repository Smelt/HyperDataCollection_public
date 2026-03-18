/**
 * Trade Size Collector Service (WebSocket-based)
 *
 * Collects trade sizes from Hyperliquid using WebSocket for real-time streaming.
 * Used for position sizing decisions (P25, P50, etc.)
 *
 * Features:
 * - Real-time trade streaming via WebSocket
 * - Only collects for pairs with profitable spreads
 * - Batched inserts for efficiency
 * - Automatic reconnection with exponential backoff
 * - Dynamic subscription management (add/remove pairs)
 */

import WebSocket from 'ws';
import { Pool } from 'mysql2/promise';
import { TradeSizeRepository, TradeSize } from '../storage/trade-size-repo.js';

interface WsTrade {
  coin: string;
  side: 'B' | 'A';
  px: string;
  sz: string;
  hash: string;
  time: number;
  tid: number;
  users: [string, string];
}

interface WsMessage {
  channel?: string;
  data?: WsTrade[];
}

export interface TradeSizeCollectorConfig {
  wsUrl: string;
  batchSize: number; // How many trades to batch before saving
  batchIntervalMs: number; // Max time to wait before flushing batch
  maxPairs: number;
  alwaysTrackPairs: string[];
}

export class TradeSizeCollector {
  private ws: WebSocket | null = null;
  private repo: TradeSizeRepository;
  private config: TradeSizeCollectorConfig;

  // Connection management
  private isConnecting = false;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 1000;
  private heartbeatInterval: NodeJS.Timeout | null = null;

  // Subscription management
  private subscribedPairs: Set<string> = new Set();
  private getPairsCallback: (() => string[]) | null = null;
  private pairRefreshInterval: NodeJS.Timeout | null = null;

  // Trade batching
  private tradeBatch: TradeSize[] = [];
  private batchFlushTimer: NodeJS.Timeout | null = null;

  // Stats
  private tradesReceived = 0;
  private tradesSaved = 0;
  private lastStatsLog = Date.now();

  constructor(pool: Pool, config: Partial<TradeSizeCollectorConfig> = {}) {
    this.config = {
      wsUrl: config.wsUrl || process.env.HYPERLIQUID_WS_URL || 'wss://api.hyperliquid.xyz/ws',
      batchSize: config.batchSize || 50,
      batchIntervalMs: config.batchIntervalMs || 5000, // Flush every 5 seconds max
      maxPairs: config.maxPairs || 6,
      alwaysTrackPairs: config.alwaysTrackPairs || ['HYPE'],
    };

    this.repo = new TradeSizeRepository(pool);
  }

  /**
   * Build the final pairs list: always-tracked pairs first, then top spread pairs
   */
  private buildPairsList(spreadPairs: string[]): string[] {
    const alwaysPairs = this.config.alwaysTrackPairs;
    const filteredSpreadPairs = spreadPairs.filter((p) => !alwaysPairs.includes(p));
    const remainingSlots = Math.max(0, this.config.maxPairs - alwaysPairs.length);
    return [...alwaysPairs, ...filteredSpreadPairs.slice(0, remainingSlots)];
  }

  /**
   * Start collecting trade sizes via WebSocket
   */
  async start(getPairs: () => string[]): Promise<void> {
    console.log('📊 Starting Trade Size Collector (WebSocket)...');
    console.log(`   WebSocket URL: ${this.config.wsUrl}`);
    console.log(`   Batch size: ${this.config.batchSize}`);
    console.log(`   Batch interval: ${this.config.batchIntervalMs}ms`);
    console.log(`   Max pairs: ${this.config.maxPairs}`);
    console.log(`   Always tracking: ${this.config.alwaysTrackPairs.join(', ')}`);

    this.getPairsCallback = getPairs;

    // Connect to WebSocket
    await this.connect();

    // Initial subscription
    const pairs = this.buildPairsList(getPairs());
    this.updateSubscriptions(pairs);

    // Set up periodic pair refresh (every 5 minutes)
    this.pairRefreshInterval = setInterval(() => {
      if (this.getPairsCallback) {
        const newPairs = this.buildPairsList(this.getPairsCallback());
        this.updateSubscriptions(newPairs);
      }
    }, 5 * 60 * 1000);

    // Set up batch flush timer
    this.startBatchFlushTimer();

    // Log stats periodically
    setInterval(() => this.logStats(), 60 * 1000);
  }

  /**
   * Stop collecting
   */
  stop(): void {
    console.log('📊 Stopping Trade Size Collector...');

    // Flush remaining trades
    this.flushBatch().catch(console.error);

    // Clear timers
    if (this.pairRefreshInterval) {
      clearInterval(this.pairRefreshInterval);
      this.pairRefreshInterval = null;
    }

    if (this.batchFlushTimer) {
      clearInterval(this.batchFlushTimer);
      this.batchFlushTimer = null;
    }

    this.stopHeartbeat();

    // Close WebSocket
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.subscribedPairs.clear();
    console.log('📊 Trade Size Collector stopped');
  }

  /**
   * Connect to WebSocket
   */
  private async connect(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN || this.isConnecting) {
      return;
    }

    this.isConnecting = true;

    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.config.wsUrl);

        this.ws.on('open', () => {
          console.log('📊 Trade WebSocket connected');
          this.isConnecting = false;
          this.reconnectAttempts = 0;
          this.startHeartbeat();

          // Resubscribe to all pairs after reconnect
          for (const pair of this.subscribedPairs) {
            this.sendSubscription(pair);
          }

          resolve();
        });

        this.ws.on('message', (data: WebSocket.Data) => {
          this.handleMessage(data);
        });

        this.ws.on('error', (error) => {
          console.error('📊 Trade WebSocket error:', error.message);
          this.isConnecting = false;
        });

        this.ws.on('close', () => {
          console.log('📊 Trade WebSocket disconnected');
          this.isConnecting = false;
          this.stopHeartbeat();
          this.handleReconnect();
        });

        // Timeout after 10 seconds
        setTimeout(() => {
          if (this.isConnecting) {
            this.isConnecting = false;
            reject(new Error('Trade WebSocket connection timeout'));
          }
        }, 10000);
      } catch (error) {
        this.isConnecting = false;
        reject(error);
      }
    });
  }

  /**
   * Handle incoming WebSocket messages
   */
  private handleMessage(data: WebSocket.Data): void {
    try {
      const message: WsMessage = JSON.parse(data.toString());

      // Handle trade updates
      if (message.channel === 'trades' && message.data && Array.isArray(message.data)) {
        for (const trade of message.data) {
          this.processTrade(trade);
        }
      }
    } catch (error) {
      // Ignore parse errors for pong/other messages
    }
  }

  /**
   * Process a single trade and add to batch
   */
  private processTrade(trade: WsTrade): void {
    this.tradesReceived++;

    const tradeSize: TradeSize = {
      tradeId: trade.tid,
      pair: trade.coin,
      size: parseFloat(trade.sz),
      price: parseFloat(trade.px),
      side: trade.side,
      timestamp: trade.time,
      buyer: trade.users[0],
      seller: trade.users[1],
    };

    this.tradeBatch.push(tradeSize);

    // Flush if batch is full
    if (this.tradeBatch.length >= this.config.batchSize) {
      this.flushBatch().catch(console.error);
    }
  }

  /**
   * Start the batch flush timer
   */
  private startBatchFlushTimer(): void {
    this.batchFlushTimer = setInterval(() => {
      if (this.tradeBatch.length > 0) {
        this.flushBatch().catch(console.error);
      }
    }, this.config.batchIntervalMs);
  }

  /**
   * Flush the current batch to database
   */
  private async flushBatch(): Promise<void> {
    if (this.tradeBatch.length === 0) return;

    const batch = this.tradeBatch;
    this.tradeBatch = [];

    try {
      const saved = await this.repo.saveBatch(batch);
      this.tradesSaved += saved;
    } catch (error) {
      console.error('📊 Error saving trade batch:', error);
      // Don't re-add to batch to avoid infinite loop
    }
  }

  /**
   * Update subscriptions based on current pairs
   */
  private updateSubscriptions(newPairs: string[]): void {
    const newPairSet = new Set(newPairs);

    // Unsubscribe from pairs no longer needed
    for (const pair of this.subscribedPairs) {
      if (!newPairSet.has(pair)) {
        this.sendUnsubscription(pair);
        this.subscribedPairs.delete(pair);
      }
    }

    // Subscribe to new pairs
    for (const pair of newPairs) {
      if (!this.subscribedPairs.has(pair)) {
        this.sendSubscription(pair);
        this.subscribedPairs.add(pair);
      }
    }

    if (this.subscribedPairs.size > 0) {
      console.log(`📊 Subscribed to trades: ${Array.from(this.subscribedPairs).join(', ')}`);
    }
  }

  /**
   * Send subscription message
   */
  private sendSubscription(coin: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    const subscription = {
      method: 'subscribe',
      subscription: {
        type: 'trades',
        coin,
      },
    };

    this.ws.send(JSON.stringify(subscription));
  }

  /**
   * Send unsubscription message
   */
  private sendUnsubscription(coin: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    const unsubscription = {
      method: 'unsubscribe',
      subscription: {
        type: 'trades',
        coin,
      },
    };

    this.ws.send(JSON.stringify(unsubscription));
  }

  /**
   * Handle reconnection with exponential backoff
   */
  private handleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('📊 Max reconnection attempts reached for trade WebSocket');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);

    console.log(
      `📊 Reconnecting trade WebSocket in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`
    );

    setTimeout(() => {
      this.connect().catch((error) => {
        console.error('📊 Trade WebSocket reconnection failed:', error.message);
      });
    }, delay);
  }

  /**
   * Start heartbeat to keep connection alive
   */
  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.ping();
      }
    }, 30000);
  }

  /**
   * Stop heartbeat
   */
  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /**
   * Log stats periodically
   */
  private logStats(): void {
    const now = Date.now();
    const elapsed = (now - this.lastStatsLog) / 1000;

    if (this.tradesReceived > 0) {
      const rate = Math.round(this.tradesReceived / elapsed);
      console.log(
        `📊 Trade stats: ${this.tradesReceived} received (${rate}/s), ${this.tradesSaved} saved, ${this.subscribedPairs.size} pairs`
      );
    }

    // Reset counters
    this.tradesReceived = 0;
    this.tradesSaved = 0;
    this.lastStatsLog = now;
  }

  /**
   * Get the repository for direct access
   */
  getRepository(): TradeSizeRepository {
    return this.repo;
  }

  /**
   * Check if WebSocket is connected
   */
  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /**
   * Get list of currently subscribed pairs
   */
  getSubscribedPairs(): string[] {
    return Array.from(this.subscribedPairs);
  }

  /**
   * Force resubscription to all pairs (useful after config changes)
   */
  async refreshSubscriptions(): Promise<void> {
    if (this.getPairsCallback) {
      const pairs = this.buildPairsList(this.getPairsCallback());
      this.updateSubscriptions(pairs);
    }
  }
}
