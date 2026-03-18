import mysql from 'mysql2/promise';
import { databaseConfig } from '../config/database.js';

let pool: mysql.Pool | null = null;

/**
 * Get or create the MySQL connection pool
 */
export function getPool(): mysql.Pool {
  if (!pool) {
    pool = mysql.createPool({
      host: databaseConfig.host,
      port: databaseConfig.port,
      user: databaseConfig.user,
      password: databaseConfig.password,
      database: databaseConfig.database,
      waitForConnections: databaseConfig.waitForConnections,
      connectionLimit: databaseConfig.connectionLimit,
      queueLimit: databaseConfig.queueLimit,
      enableKeepAlive: databaseConfig.enableKeepAlive,
      keepAliveInitialDelay: databaseConfig.keepAliveInitialDelay,
    });

    console.log('Database connection pool created');
  }

  return pool;
}

/**
 * Close the connection pool
 */
export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    console.log('Database connection pool closed');
  }
}

/**
 * Test the database connection
 */
export async function testConnection(): Promise<boolean> {
  try {
    const connection = await getPool().getConnection();
    await connection.ping();
    connection.release();
    console.log('✓ Database connection test successful');
    return true;
  } catch (error) {
    console.error('✗ Database connection test failed:', error);
    return false;
  }
}

/**
 * Execute a query with timing and error logging
 */
export async function executeQuery<T = any>(
  operation: string,
  query: string,
  params?: any[]
): Promise<T> {
  const start = Date.now();

  try {
    const pool = getPool();
    const [results] = await pool.execute(query, params);
    const duration = Date.now() - start;

    if (duration > 1000) {
      console.warn(
        `Slow query: ${operation} took ${duration}ms`
      );
    }

    return results as T;
  } catch (error) {
    const duration = Date.now() - start;
    console.error(
      `Query failed: ${operation} (${duration}ms)`,
      error
    );
    throw error;
  }
}

/**
 * Health check query to verify database is accessible
 */
export async function healthCheck(): Promise<{
  healthy: boolean;
  latencyMs?: number;
  error?: string;
}> {
  const start = Date.now();

  try {
    const pool = getPool();
    await pool.execute('SELECT 1');
    const latencyMs = Date.now() - start;

    return {
      healthy: true,
      latencyMs,
    };
  } catch (error) {
    return {
      healthy: false,
      error:
        error instanceof Error
          ? error.message
          : 'Unknown error',
    };
  }
}
