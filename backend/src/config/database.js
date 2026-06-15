/**
 * HandyTrust — PostgreSQL Database Configuration
 * Connection pool with health monitoring and transaction helpers
 */

const { Pool } = require('pg');
const logger = require('../utils/logger');

const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT) || 5432,
    database: process.env.DB_NAME || 'handytrust',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD,
    min: parseInt(process.env.DB_POOL_MIN) || 2,
    max: parseInt(process.env.DB_POOL_MAX) || 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

pool.on('connect', () => logger.debug('DB: new client connected'));
pool.on('error', (err) => logger.error('DB pool error', { error: err.message }));

/**
 * Execute a parameterised query
 */
const query = async (text, params) => {
    const start = Date.now();
    try {
        const res = await pool.query(text, params);
        const ms = Date.now() - start;
        if (ms > 1000) logger.warn('Slow query', { ms, text: text.slice(0, 80) });
        return res;
    } catch (err) {
        logger.error('DB query error', { error: err.message, text: text.slice(0, 80) });
        throw err;
    }
};

/**
 * Acquire a client for manual transaction control
 */
const getClient = async () => {
    const client = await pool.connect();
    const release = client.release.bind(client);
    client.release = () => {
        client.release = release;
        release();
    };
    return client;
};

/**
 * Run fn(client) inside a BEGIN/COMMIT/ROLLBACK transaction
 */
const withTransaction = async (fn) => {
    const client = await getClient();
    try {
        await client.query('BEGIN');
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
};

/**
 * Lightweight health check
 */
const checkHealth = async () => {
    try {
        const { rows } = await pool.query('SELECT NOW() AS now');
        return { healthy: true, timestamp: rows[0].now };
    } catch (err) {
        return { healthy: false, error: err.message };
    }
};

module.exports = { query, getClient, withTransaction, checkHealth, pool };