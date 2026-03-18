import dotenv from 'dotenv';

dotenv.config();

export const databaseConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '3306'),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'Crypto',

  // Connection pool settings
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,

  // Retention policies (in milliseconds)
  retention: {
    snapshots: 7 * 24 * 60 * 60 * 1000, // 7 days
    signals: 30 * 24 * 60 * 60 * 1000, // 30 days
    hourlyStats: Infinity, // Forever
  },
};

export const collectionConfig = {
  snapshotIntervalMs: parseInt(
    process.env.SNAPSHOT_INTERVAL_MS || '5000'
  ),
  statsCalculationIntervalMs: parseInt(
    process.env.STATS_CALCULATION_INTERVAL_MS || '60000'
  ),
  cleanupIntervalHours: parseInt(
    process.env.CLEANUP_INTERVAL_HOURS || '24'
  ),
};
