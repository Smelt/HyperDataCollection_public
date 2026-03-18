import WebSocket from 'ws';
import { L2OrderBook } from '../types/index.js';

export type OrderBookCallback = (orderBook: L2OrderBook) => void;

export class HyperliquidWebSocket {
  private ws: WebSocket | null = null;
  private wsUrl: string;
  private subscriptions: Map<string, OrderBookCallback[]> = new Map();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 1000;
  private isConnecting = false;
  private heartbeatInterval: NodeJS.Timeout | null = null;

  constructor(wsUrl: string) {
    this.wsUrl = wsUrl;
  }

  /**
   * Connect to the WebSocket server
   */
  async connect(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN || this.isConnecting) {
      return;
    }

    this.isConnecting = true;

    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.wsUrl);

        this.ws.on('open', () => {
          console.log('WebSocket connected');
          this.isConnecting = false;
          this.reconnectAttempts = 0;
          this.startHeartbeat();

          // Resubscribe to all pairs
          for (const coin of this.subscriptions.keys()) {
            this.sendSubscription(coin);
          }

          resolve();
        });

        this.ws.on('message', (data: WebSocket.Data) => {
          this.handleMessage(data);
        });

        this.ws.on('error', (error) => {
          console.error('WebSocket error:', error.message);
          this.isConnecting = false;
        });

        this.ws.on('close', () => {
          console.log('WebSocket disconnected');
          this.isConnecting = false;
          this.stopHeartbeat();
          this.handleReconnect();
        });

        // Timeout after 10 seconds
        setTimeout(() => {
          if (this.isConnecting) {
            this.isConnecting = false;
            reject(new Error('WebSocket connection timeout'));
          }
        }, 10000);
      } catch (error) {
        this.isConnecting = false;
        reject(error);
      }
    });
  }

  /**
   * Subscribe to L2 order book updates for a specific coin
   */
  subscribe(coin: string, callback: OrderBookCallback): void {
    if (!this.subscriptions.has(coin)) {
      this.subscriptions.set(coin, []);
    }

    this.subscriptions.get(coin)!.push(callback);

    // Send subscription if already connected
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.sendSubscription(coin);
    }
  }

  /**
   * Unsubscribe from a specific coin
   */
  unsubscribe(coin: string): void {
    this.subscriptions.delete(coin);

    if (this.ws?.readyState === WebSocket.OPEN) {
      this.sendUnsubscription(coin);
    }
  }

  /**
   * Close the WebSocket connection
   */
  close(): void {
    this.stopHeartbeat();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.subscriptions.clear();
  }

  private sendSubscription(coin: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    const subscription = {
      method: 'subscribe',
      subscription: {
        type: 'l2Book',
        coin,
      },
    };

    this.ws.send(JSON.stringify(subscription));
  }

  private sendUnsubscription(coin: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    const unsubscription = {
      method: 'unsubscribe',
      subscription: {
        type: 'l2Book',
        coin,
      },
    };

    this.ws.send(JSON.stringify(unsubscription));
  }

  private handleMessage(data: WebSocket.Data): void {
    try {
      const message = JSON.parse(data.toString());

      // Handle L2 order book updates
      if (message.channel === 'l2Book' && message.data) {
        const orderBook: L2OrderBook = message.data;
        const callbacks = this.subscriptions.get(orderBook.coin);

        if (callbacks) {
          callbacks.forEach(callback => callback(orderBook));
        }
      }
    } catch (error) {
      console.error('Error parsing WebSocket message:', error);
    }
  }

  private handleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('Max reconnection attempts reached');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);

    console.log(
      `Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`
    );

    setTimeout(() => {
      this.connect().catch((error) => {
        console.error('Reconnection failed:', error.message);
      });
    }, delay);
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.ping();
      }
    }, 30000); // Ping every 30 seconds
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}
