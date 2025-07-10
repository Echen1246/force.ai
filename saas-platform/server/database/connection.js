const { Pool } = require('pg');
const logger = require('../utils/logger');

// Create PostgreSQL connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 20, // Maximum number of connections in the pool
  min: 5,  // Minimum number of connections in the pool
  idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
  connectionTimeoutMillis: 2000, // Return an error after 2 seconds if connection cannot be established
  maxUses: 7500, // Close (and replace) a connection after it has been used 7500 times
});

// Handle pool errors
pool.on('error', (err) => {
  logger.error('Unexpected error on idle database client:', err);
  process.exit(-1);
});

// Handle pool connection events
pool.on('connect', (client) => {
  logger.debug('New database client connected');
});

pool.on('acquire', (client) => {
  logger.debug('Database client acquired from pool');
});

pool.on('remove', (client) => {
  logger.debug('Database client removed from pool');
});

// Test database connection
async function testConnection() {
  try {
    const client = await pool.connect();
    const result = await client.query('SELECT NOW() as now, version() as version');
    client.release();
    
    logger.info('Database connection successful:', {
      timestamp: result.rows[0].now,
      version: result.rows[0].version.split(' ')[0] + ' ' + result.rows[0].version.split(' ')[1]
    });
    
    return true;
  } catch (err) {
    logger.error('Database connection failed:', err);
    return false;
  }
}

// Execute a query with error logging
async function query(text, params) {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    
    // Log slow queries (>100ms)
    if (duration > 100) {
      logger.warn('Slow query detected:', {
        duration: duration + 'ms',
        query: text,
        rowCount: result.rowCount
      });
    }
    
    return result;
  } catch (err) {
    const duration = Date.now() - start;
    logger.error('Database query error:', {
      error: err.message,
      duration: duration + 'ms',
      query: text,
      params: params
    });
    throw err;
  }
}

// Transaction helper
async function transaction(callback) {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Get database statistics
async function getStats() {
  try {
    const result = await pool.query(`
      SELECT 
        (SELECT count(*) FROM workspaces) as total_workspaces,
        (SELECT count(*) FROM users) as total_users,
        (SELECT count(*) FROM workers) as total_workers,
        (SELECT count(*) FROM tasks) as total_tasks,
        (SELECT count(*) FROM workers WHERE status = 'online') as online_workers,
        (SELECT count(*) FROM tasks WHERE status = 'running') as running_tasks
    `);
    
    return {
      pool: {
        totalConnections: pool.totalCount,
        idleConnections: pool.idleCount,
        waitingRequests: pool.waitingCount
      },
      database: result.rows[0]
    };
  } catch (err) {
    logger.error('Failed to get database stats:', err);
    throw err;
  }
}

// Graceful shutdown
async function close() {
  logger.info('Closing database connection pool...');
  await pool.end();
  logger.info('Database connection pool closed');
}

// Handle process termination
process.on('SIGINT', close);
process.on('SIGTERM', close);

module.exports = {
  pool,
  query,
  transaction,
  testConnection,
  getStats,
  close
}; 