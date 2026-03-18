import { HyperliquidAPI } from '../api/hyperliquid.js';
import { HyperliquidWebSocket } from '../api/websocket.js';
import { SpreadCalculator } from './spread.js';
import { L2OrderBook, SpreadData } from '../types/index.js';

export type SpreadDataCallback = (data: SpreadData) => void;

export class OrderBookMonitor {
  private api: HyperliquidAPI;
  private ws: HyperliquidWebSocket;
  private callbacks: SpreadDataCallback[] = [];
  private pairs: string[];
  private intervalMs: number;
  private useWebSocket: boolean;
  private pollIntervals: Map<string, NodeJS.Timeout> = new Map();

  constructor(
    apiUrl: string,
    wsUrl: string,
    pairs: string[],
    intervalMs: number = 1000,
    useWebSocket: boolean = true
  ) {
    this.api = new HyperliquidAPI(apiUrl);
    this.ws = new HyperliquidWebSocket(wsUrl);
    this.pairs = pairs;
    this.intervalMs = intervalMs;
    this.useWebSocket = useWebSocket;
  }

  /**
   * Register a callback to receive spread data
   */
  onSpreadData(callback: SpreadDataCallback): void {
    this.callbacks.push(callback);
  }

  /**
   * Start monitoring order books
   */
  async start(): Promise<void> {
    console.log(`Starting order book monitor for pairs: ${this.pairs.join(', ')}`);

    if (this.useWebSocket) {
      await this.startWebSocketMonitoring();
    } else {
      this.startPollingMonitoring();
    }
  }

  /**
   * Stop monitoring
   */
  stop(): void {
    console.log('Stopping order book monitor');

    if (this.useWebSocket) {
      this.ws.close();
    } else {
      // Clear all polling intervals
      for (const interval of this.pollIntervals.values()) {
        clearInterval(interval);
      }
      this.pollIntervals.clear();
    }
  }

  /**
   * Start WebSocket-based monitoring
   */
  private async startWebSocketMonitoring(): Promise<void> {
    try {
      await this.ws.connect();

      for (const pair of this.pairs) {
        this.ws.subscribe(pair, (orderBook: L2OrderBook) => {
          this.processOrderBook(orderBook);
        });
      }

      console.log('WebSocket monitoring started');
    } catch (error) {
      console.error('Failed to start WebSocket monitoring:', error);
      console.log('Falling back to polling...');
      this.useWebSocket = false;
      this.startPollingMonitoring();
    }
  }

  /**
   * Start polling-based monitoring
   */
  private startPollingMonitoring(): void {
    for (const pair of this.pairs) {
      const interval = setInterval(async () => {
        try {
          const orderBook = await this.api.getL2OrderBook(pair);
          this.processOrderBook(orderBook);
        } catch (error) {
          if (error instanceof Error) {
            console.error(`Error fetching order book for ${pair}:`, error.message);
          }
        }
      }, this.intervalMs);

      this.pollIntervals.set(pair, interval);
    }

    console.log('Polling monitoring started');
  }

  /**
   * Process an order book and calculate spread data
   */
  private processOrderBook(orderBook: L2OrderBook): void {
    const spreadData = SpreadCalculator.calculateSpread(orderBook);

    if (spreadData) {
      // Notify all callbacks
      this.callbacks.forEach(callback => callback(spreadData));
    }
  }

  /**
   * Get current order book for a specific pair
   */
  async getCurrentOrderBook(pair: string): Promise<L2OrderBook> {
    return this.api.getL2OrderBook(pair);
  }

  /**
   * Check if monitoring is active
   */
  isActive(): boolean {
    return this.useWebSocket ? this.ws.isConnected : this.pollIntervals.size > 0;
  }
}
