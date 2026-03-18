/**
 * Run migration 006: Create bot_trades and market_metrics tables
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config();

async function runMigration() {
  console.log('📊 Running Migration 006: bot_trades and market_metrics tables\n');

  // Create database connection
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '3306'),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    multipleStatements: true, // Allow running multiple SQL statements
  });

  try {
    // Read migration file
    const migrationPath = path.join(
      __dirname,
      '..',
      'database',
      'migrations',
      '006_create_bot_trades_and_metrics.sql'
    );

    console.log(`📂 Reading migration file: ${migrationPath}`);
    const sql = fs.readFileSync(migrationPath, 'utf8');

    // Execute migration
    console.log('⚙️  Executing migration...\n');
    await connection.query(sql);

    console.log('✅ Migration 006 completed successfully!');
    console.log('\n📊 Created tables:');
    console.log('   - bot_trades (trade logs with entry conditions)');
    console.log('   - market_metrics (real-time market snapshots)');

    // Verify tables exist
    console.log('\n🔍 Verifying tables...');

    const [botTradesRows] = await connection.query(
      "SHOW TABLES LIKE 'bot_trades'"
    );
    const [marketMetricsRows] = await connection.query(
      "SHOW TABLES LIKE 'market_metrics'"
    );

    if ((botTradesRows as any[]).length > 0) {
      console.log('   ✅ bot_trades table created');
    } else {
      console.error('   ❌ bot_trades table not found!');
    }

    if ((marketMetricsRows as any[]).length > 0) {
      console.log('   ✅ market_metrics table created');
    } else {
      console.error('   ❌ market_metrics table not found!');
    }

    // Show table structures
    console.log('\n📋 bot_trades structure:');
    const [botTradesDesc] = await connection.query('DESCRIBE bot_trades');
    console.log(botTradesDesc);

    console.log('\n📋 market_metrics structure:');
    const [marketMetricsDesc] = await connection.query('DESCRIBE market_metrics');
    console.log(marketMetricsDesc);

  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await connection.end();
  }
}

// Run migration
runMigration().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
