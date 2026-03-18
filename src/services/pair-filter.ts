import { HyperliquidAPI } from '../api/hyperliquid.js';
import { getPool } from '../storage/database.js';

interface PairMetrics {
  pair: string;
  avgSpread: number;
  profitAfterFees: number;
  volatility: number;
  sampleCount: number;
}

export class PairFilterService {
  private api: HyperliquidAPI;
  private filteredPairs: Set<string> = new Set();
  private lastScanTime: number = 0;
  private scanInterval: number;
  private minProfitBps: number;
  private maxPairs: number;

  constructor(
    apiUrl: string,
    scanIntervalMs: number = 24 * 60 * 60 * 1000, // 24 hours
    minProfitBps: number = 5, // Minimum 5 bps profit after fees
    maxPairs: number = 30, // Maximum 30 pairs to track
    hip3Dexes: string[] = [] // HIP-3 builder dex names to include
  ) {
    this.api = new HyperliquidAPI(apiUrl, hip3Dexes);
    this.scanInterval = scanIntervalMs;
    this.minProfitBps = minProfitBps;
    this.maxPairs = maxPairs;
  }

  /**
   * Run discovery scan to find profitable pairs
   */
  async runDiscoveryScan(): Promise<string[]> {
    const now = Date.now();

    // Skip if we scanned recently (within last hour)
    if (now - this.lastScanTime < 60 * 60 * 1000) {
      console.log('⏭️  Skipping discovery scan (ran recently)');
      return Array.from(this.filteredPairs);
    }

    console.log('🔍 Running discovery scan for profitable pairs...');

    try {
      // Get all available pairs
      const allPairs = await this.api.getAllPerpetuals();
      console.log(`   Found ${allPairs.length} total pairs`);

      // Quick sample: Get current spread for each pair
      const metrics: PairMetrics[] = [];

      for (const pair of allPairs) {
        try {
          const orderBook = await this.api.getL2OrderBook(pair);

          if (!orderBook.levels || !orderBook.levels[0].length || !orderBook.levels[1].length) {
            continue;
          }

          const bestBid = parseFloat(orderBook.levels[0][0].px);
          const bestAsk = parseFloat(orderBook.levels[1][0].px);
          const midPrice = (bestBid + bestAsk) / 2;
          const spreadPct = ((bestAsk - bestBid) / midPrice) * 100;
          const spreadBps = spreadPct * 100;
          const profitAfterFees = spreadBps - 3.0; // 2x maker fee (1.5 bps each side)

          if (profitAfterFees > 0) {
            metrics.push({
              pair,
              avgSpread: spreadBps,
              profitAfterFees,
              volatility: 0, // We'll calculate from historical if needed
              sampleCount: 1
            });
          }

          // Rate limit: small delay between requests
          await new Promise(resolve => setTimeout(resolve, 50));
        } catch (error) {
          // Skip pairs that error
          continue;
        }
      }

      // Sort by profitability
      metrics.sort((a, b) => b.profitAfterFees - a.profitAfterFees);

      // Filter: Take top pairs that meet minimum profit threshold
      const profitablePairs = metrics
        .filter(m => m.profitAfterFees >= this.minProfitBps)
        .slice(0, this.maxPairs)
        .map(m => m.pair);

      // Update filtered pairs
      const previousPairs = new Set(this.filteredPairs);
      this.filteredPairs = new Set(profitablePairs);

      // Log changes
      const added = profitablePairs.filter(p => !previousPairs.has(p));
      const removed = Array.from(previousPairs).filter(p => !this.filteredPairs.has(p));

      console.log(`✅ Discovery scan complete:`);
      console.log(`   • Profitable pairs: ${profitablePairs.length}`);
      console.log(`   • Added: ${added.length} pairs - ${added.join(', ') || 'none'}`);
      console.log(`   • Removed: ${removed.length} pairs - ${removed.join(', ') || 'none'}`);
      console.log(`   • Tracking: ${Array.from(this.filteredPairs).slice(0, 10).join(', ')}...`);

      this.lastScanTime = now;
      return profitablePairs;

    } catch (error) {
      console.error('❌ Discovery scan failed:', error);
      return Array.from(this.filteredPairs);
    }
  }

  /**
   * Get currently filtered pairs
   */
  getFilteredPairs(): string[] {
    return Array.from(this.filteredPairs);
  }

  /**
   * Check if a pair should be tracked
   */
  shouldTrackPair(pair: string): boolean {
    return this.filteredPairs.has(pair);
  }

  /**
   * Initialize with historical data
   */
  async initializeFromDatabase(): Promise<void> {
    console.log('📊 Initializing pair filter from database...');

    try {
      const pool = getPool();
      const [rows] = await pool.query<any[]>(`
        SELECT
          pair,
          AVG(spread_bps) as avg_spread_bps,
          AVG(spread_bps) - 3.0 as profit_after_fees,
          COUNT(*) as sample_count
        FROM spread_snapshots
        WHERE timestamp > (UNIX_TIMESTAMP(NOW()) - 86400) * 1000
        GROUP BY pair
        HAVING profit_after_fees >= ?
        ORDER BY profit_after_fees DESC
        LIMIT ?
      `, [this.minProfitBps, this.maxPairs]);

      const profitablePairs = rows.map((row: any) => row.pair);
      this.filteredPairs = new Set(profitablePairs);

      console.log(`   ✅ Initialized with ${profitablePairs.length} profitable pairs from last 24h`);
      console.log(`   • Top pairs: ${profitablePairs.slice(0, 10).join(', ')}`);

      this.lastScanTime = Date.now();
    } catch (error) {
      console.error('❌ Failed to initialize from database:', error);
      // Fall back to empty set - will populate on first scan
      this.filteredPairs = new Set();
    }
  }

  /**
   * Get scan interval
   */
  getScanInterval(): number {
    return this.scanInterval;
  }

  /**
   * Force a scan now
   */
  async forceScan(): Promise<string[]> {
    this.lastScanTime = 0; // Reset to force scan
    return this.runDiscoveryScan();
  }
}
