import { L2OrderBook, SpreadData } from '../types/index.js';

export class SpreadCalculator {
  /**
   * Calculate spread data from an L2 order book
   */
  static calculateSpread(orderBook: L2OrderBook): SpreadData | null {
    const [bids, asks] = orderBook.levels;

    // Validate that we have bids and asks
    if (!bids || !asks || bids.length === 0 || asks.length === 0) {
      return null;
    }

    const bestBid = parseFloat(bids[0].px);
    const bestAsk = parseFloat(asks[0].px);
    const bidSize = parseFloat(bids[0].sz);
    const askSize = parseFloat(asks[0].sz);

    // Validate prices
    if (bestBid <= 0 || bestAsk <= 0 || bestAsk <= bestBid) {
      return null;
    }

    const spread = bestAsk - bestBid;
    const midPrice = (bestBid + bestAsk) / 2;
    const spreadPct = (spread / midPrice) * 100;
    const spreadBps = spreadPct * 100; // basis points

    // Calculate order book imbalance
    const totalSize = bidSize + askSize;
    const imbalance = totalSize > 0 ? (bidSize - askSize) / totalSize : 0;

    return {
      timestamp: orderBook.time,
      pair: orderBook.coin,
      bestBid,
      bestAsk,
      bidSize,
      askSize,
      spread,
      spreadBps,
      spreadPct,
      midPrice,
      imbalance,
    };
  }

  /**
   * Calculate order book depth (total volume at various price levels)
   */
  static calculateDepth(
    orderBook: L2OrderBook,
    levels: number = 5
  ): { bidDepth: number; askDepth: number } {
    const [bids, asks] = orderBook.levels;

    const bidDepth = bids
      .slice(0, levels)
      .reduce((sum, level) => sum + parseFloat(level.sz), 0);

    const askDepth = asks
      .slice(0, levels)
      .reduce((sum, level) => sum + parseFloat(level.sz), 0);

    return { bidDepth, askDepth };
  }

  /**
   * Check if spread is profitable after fees
   */
  static isProfitable(
    spreadBps: number,
    makerFeeBps: number
  ): boolean {
    // For market making, we pay maker fee on both sides
    const totalFees = makerFeeBps * 2;
    return spreadBps > totalFees;
  }

  /**
   * Calculate theoretical profit in basis points
   */
  static calculateProfitBps(
    spreadBps: number,
    makerFeeBps: number
  ): number {
    return spreadBps - (makerFeeBps * 2);
  }

  /**
   * Determine spread quality based on configured thresholds
   */
  static getSpreadQuality(
    spreadPct: number,
    minSpread: number
  ): 'good' | 'tight' | 'wide' {
    if (spreadPct >= minSpread * 1.5) {
      return 'wide';
    } else if (spreadPct >= minSpread) {
      return 'good';
    } else {
      return 'tight';
    }
  }
}
