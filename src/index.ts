import { config } from './config/index.js';
import { HyperliquidAPI } from './api/hyperliquid.js';
import { OrderBookMonitor } from './monitors/orderbook.js';
import { CSVLogger } from './storage/csv-logger.js';
import { StatisticsCalculator } from './storage/stats.js';
import { Dashboard } from './display/dashboard.js';
import { SpreadData } from './types/index.js';
import { DatabaseLogger } from './storage/db-logger.js';
import { StatsCalculator } from './storage/stats-calculator.js';
import { testConnection, closePool, getPool } from './storage/database.js';
import { collectionConfig } from './config/database.js';
import { PairFilterService } from './services/pair-filter.js';
import { TradeSizeCollector } from './services/trade-size-collector.js';

class HyperliquidMarketMaker {
  private monitor: OrderBookMonitor | null = null;
  private csvLogger: CSVLogger;
  private statsCalculator: StatisticsCalculator;
  private dashboard: Dashboard;
  private dbLogger: DatabaseLogger | null = null;
  private hourlyStatsCalculator: StatsCalculator | null = null;
  private pairFilter: PairFilterService | null = null;
  private tradeSizeCollector: TradeSizeCollector | null = null;
  private dashboardInterval: NodeJS.Timeout | null = null;
  private statsExportInterval: NodeJS.Timeout | null = null;
  private discoveryScanInterval: NodeJS.Timeout | null = null;
  private pairs: string[] = [];
  private enableDbLogging: boolean = false;
  private enableSmartFiltering: boolean = false;
  private enableTradeSizeCollection: boolean = false;

  constructor() {
    // Initialize storage and display components
    this.csvLogger = new CSVLogger(config.dataDir, config.enableCsvLogging);
    this.statsCalculator = new StatisticsCalculator(
      config.dataDir,
      config.enableJsonSummary
    );
    this.dashboard = new Dashboard();

    // Check if database logging is enabled
    this.enableDbLogging = process.env.ENABLE_DB_LOGGING === 'true';

    // Check if smart filtering is enabled
    this.enableSmartFiltering = process.env.ENABLE_SMART_FILTERING === 'true';

    // Check if trade size collection is enabled (defaults to true if DB logging is enabled)
    this.enableTradeSizeCollection = process.env.ENABLE_TRADE_SIZE_COLLECTION !== 'false';
  }

  /**
   * Initialize pairs list (fetch all or use configured pairs)
   */
  private async initializePairs(): Promise<void> {
    // If smart filtering is enabled, use PairFilterService
    if (this.enableSmartFiltering) {
      console.log('🎯 Smart filtering enabled - tracking only profitable pairs');

      // Initialize pair filter service
      const minProfitBps = parseInt(process.env.MIN_PROFIT_BPS || '5');
      const maxPairs = parseInt(process.env.MAX_PAIRS || '30');
      const scanIntervalHours = parseInt(process.env.SCAN_INTERVAL_HOURS || '24');
      const hip3Dexes = process.env.HIP3_DEXES
        ? process.env.HIP3_DEXES.split(',').map(d => d.trim()).filter(Boolean)
        : [];

      if (hip3Dexes.length > 0) {
        console.log(`   📈 HIP-3 dexes enabled: ${hip3Dexes.join(', ')}`);
      }

      this.pairFilter = new PairFilterService(
        config.hyperliquidApiUrl,
        scanIntervalHours * 60 * 60 * 1000, // Convert hours to ms
        minProfitBps,
        maxPairs,
        hip3Dexes
      );

      // Skip database initialization (slow query on large dataset)
      // Run discovery scan directly (faster)
      console.log('   Running initial discovery scan...');
      this.pairs = await this.pairFilter.runDiscoveryScan();

      console.log(`   ✅ Tracking ${this.pairs.length} profitable pairs (min profit: ${minProfitBps} bps)`);
      console.log(`   📊 Top pairs: ${this.pairs.slice(0, 5).join(', ')}`);

      return;
    }

    // Original logic: Check if user wants to monitor all pairs
    if (config.pairs.length === 1 && config.pairs[0].toLowerCase() === 'all') {
      console.log('Fetching all available perpetuals from Hyperliquid...');
      const hip3Dexes = process.env.HIP3_DEXES
        ? process.env.HIP3_DEXES.split(',').map(d => d.trim()).filter(Boolean)
        : [];
      const api = new HyperliquidAPI(config.hyperliquidApiUrl, hip3Dexes);
      this.pairs = await api.getAllPerpetuals();
      console.log(`Found ${this.pairs.length} perpetuals to monitor`);
    } else {
      this.pairs = config.pairs;
    }
  }

  /**
   * Start the market maker
   */
  async start(): Promise<void> {
    console.log('Starting Hyperliquid Market Making Monitor...');

    // Initialize pairs list
    await this.initializePairs();

    console.log(`Monitoring ${this.pairs.length} pairs: ${this.pairs.slice(0, 10).join(', ')}${this.pairs.length > 10 ? '...' : ''}`);
    console.log(`Data directory: ${config.dataDir}`);
    console.log(`CSV logging: ${config.enableCsvLogging ? 'enabled' : 'disabled'}`);
    console.log(`JSON summary: ${config.enableJsonSummary ? 'enabled' : 'disabled'}`);

    // Initialize database logging if enabled
    if (this.enableDbLogging) {
      console.log('Database logging: enabled');
      console.log('Testing database connection...');

      const dbConnected = await testConnection();

      if (dbConnected) {
        // Initialize database logger with batching
        this.dbLogger = new DatabaseLogger(
          100, // batch size
          5000, // batch timeout (5 seconds)
          true // enabled
        );

        // Initialize hourly stats calculator
        this.hourlyStatsCalculator = new StatsCalculator(
          this.pairs,
          collectionConfig.statsCalculationIntervalMs
        );

        // Start stats calculator
        this.hourlyStatsCalculator.start();

        console.log('✓ Database connection established');

        // Initialize trade size collector if enabled (WebSocket-based)
        if (this.enableTradeSizeCollection) {
          const tradeSizeMaxPairs = parseInt(process.env.TRADE_SIZE_MAX_PAIRS || '6'); // Top 6 pairs default
          const tradeBatchSize = parseInt(process.env.TRADE_BATCH_SIZE || '50'); // Batch 50 trades before saving
          const tradeBatchIntervalMs = parseInt(process.env.TRADE_BATCH_INTERVAL_MS || '5000'); // 5 seconds max batch wait
          const alwaysTrackPairs = (process.env.TRADE_ALWAYS_TRACK_PAIRS || 'HYPE').split(',').map(p => p.trim());

          this.tradeSizeCollector = new TradeSizeCollector(getPool(), {
            wsUrl: config.hyperliquidWsUrl,
            batchSize: tradeBatchSize,
            batchIntervalMs: tradeBatchIntervalMs,
            maxPairs: tradeSizeMaxPairs,
            alwaysTrackPairs,
          });

          // Start collecting via WebSocket - uses the pairs from pairFilter or this.pairs
          await this.tradeSizeCollector.start(() => this.pairs);
          console.log(`✓ Trade size collection enabled (WebSocket, ${tradeSizeMaxPairs} pairs, batch: ${tradeBatchSize}, always tracking: ${alwaysTrackPairs.join(', ')})`);
        }
      } else {
        console.warn('⚠ Database connection failed - continuing without database logging');
        this.enableDbLogging = false;
        this.enableTradeSizeCollection = false;
      }
    } else {
      console.log('Database logging: disabled');
    }

    console.log('');

    // Initialize monitor with resolved pairs
    this.monitor = new OrderBookMonitor(
      config.hyperliquidApiUrl,
      config.hyperliquidWsUrl,
      this.pairs,
      config.snapshotIntervalMs
    );

    // Register callback for spread data
    this.monitor.onSpreadData(this.handleSpreadData.bind(this));

    // Start monitoring
    await this.monitor.start();

    // Start dashboard updates (every 2 seconds)
    this.dashboardInterval = setInterval(() => {
      this.updateDashboard();
    }, 2000);

    // Export stats summary every 5 minutes
    if (config.enableJsonSummary) {
      this.statsExportInterval = setInterval(() => {
        this.statsCalculator.exportSummary().catch((error) => {
          console.error('Error exporting stats summary:', error);
        });
      }, 5 * 60 * 1000);
    }

    // Set up daily discovery scan if smart filtering is enabled
    if (this.enableSmartFiltering && this.pairFilter) {
      const scanIntervalMs = this.pairFilter.getScanInterval();
      this.discoveryScanInterval = setInterval(async () => {
        console.log('🔍 Running scheduled discovery scan...');
        const newPairs = await this.pairFilter!.runDiscoveryScan();

        // Restart monitor with new pairs if they changed
        if (newPairs.length !== this.pairs.length || !newPairs.every(p => this.pairs.includes(p))) {
          console.log('   ♻️ Pair list changed - restarting monitor...');
          this.pairs = newPairs;

          if (this.monitor) {
            this.monitor.stop();
          }

          this.monitor = new OrderBookMonitor(
            config.hyperliquidApiUrl,
            config.hyperliquidWsUrl,
            this.pairs,
            config.snapshotIntervalMs
          );

          this.monitor.onSpreadData(this.handleSpreadData.bind(this));
          await this.monitor.start();

          console.log('   ✅ Monitor restarted with updated pairs');
        }
      }, scanIntervalMs);

      console.log(`   📅 Discovery scan scheduled every ${scanIntervalMs / (60 * 60 * 1000)} hours`);
    }

    // Handle graceful shutdown
    this.setupShutdownHandlers();

    console.log('Monitor started successfully!');
    console.log('Dashboard will appear in 2 seconds...');
  }

  /**
   * Handle incoming spread data
   */
  private handleSpreadData(data: SpreadData): void {
    // Log to CSV
    this.csvLogger.log(data).catch((error) => {
      console.error('Error logging to CSV:', error);
    });

    // Log to database if enabled
    if (this.dbLogger && this.enableDbLogging) {
      this.dbLogger.logSpread(data).catch((error) => {
        console.error('Error logging to database:', error);
      });
    }

    // Add to statistics
    this.statsCalculator.addDataPoint(data);

    // Update dashboard with latest data
    this.dashboard.updateSpreadData(data);
  }

  /**
   * Update and render the dashboard
   */
  private updateDashboard(): void {
    const stats = this.statsCalculator.getAllStats();
    const opportunities = this.statsCalculator.identifyOpportunities(
      config.makerFeeBps
    );
    const totalDataPoints = this.statsCalculator.getTotalDataPoints();

    this.dashboard.render(stats, opportunities, totalDataPoints);
  }

  /**
   * Stop the market maker
   */
  private async stop(): Promise<void> {
    console.log('\nStopping Hyperliquid Market Making Monitor...');

    // Stop monitoring
    if (this.monitor) {
      this.monitor.stop();
    }

    // Clear intervals
    if (this.dashboardInterval) {
      clearInterval(this.dashboardInterval);
    }

    if (this.statsExportInterval) {
      clearInterval(this.statsExportInterval);
    }

    if (this.discoveryScanInterval) {
      clearInterval(this.discoveryScanInterval);
    }

    // Stop database components if enabled
    if (this.enableDbLogging) {
      if (this.dbLogger) {
        await this.dbLogger.shutdown();
      }

      if (this.hourlyStatsCalculator) {
        this.hourlyStatsCalculator.stop();
      }

      // Stop trade size collector
      if (this.tradeSizeCollector) {
        this.tradeSizeCollector.stop();
      }

      // Close database connection pool
      await closePool();
    }

    // Export final stats
    if (config.enableJsonSummary) {
      this.statsCalculator.exportSummary().catch((error) => {
        console.error('Error exporting final stats:', error);
      });
    }

    console.log('Monitor stopped.');
    process.exit(0);
  }

  /**
   * Setup shutdown handlers
   */
  private setupShutdownHandlers(): void {
    process.on('SIGINT', () => {
      this.stop();
    });

    process.on('SIGTERM', () => {
      this.stop();
    });
  }
}

// Start the application
const app = new HyperliquidMarketMaker();
app.start().catch((error) => {
  console.error('Failed to start market maker:', error);
  process.exit(1);
});
