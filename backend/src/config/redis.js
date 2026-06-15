/**
 * HandyTrust — Redis Client
 * Used for: matching cache, session blacklist, rate limiting, job queues
 */

const { createClient } = require('redis');
const logger = require('../utils/logger');

const client = createClient({
    url: process.env.REDIS_URL || 'redis://localhost:6379',
    password: process.env.REDIS_PASSWORD || undefined,
    socket: {
        reconnectStrategy: (retries) => {
            if (retries > 10) {
                logger.error('Redis: max reconnection attempts reached');
                return new Error('Redis max retries exceeded');
            }
            return Math.min(retries * 100, 3000);
        },
        connectTimeout: 5000,
    },
});

client.on('connect', () => logger.info('Redis connecting…'));
client.on('ready', () => logger.info('✅ Redis ready'));
client.on('error', (err) => logger.error('Redis error', { error: err.message }));
client.on('reconnecting', () => logger.warn('Redis reconnecting…'));
client.on('end', () => logger.info('Redis connection closed'));

// Connect on module load (non-blocking; server.js awaits ping after import)
client.connect().catch((err) => {
    logger.error('Redis initial connect failed', { error: err.message });
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Set a JSON value with optional TTL (seconds)
 */
const setJSON = async (key, value, ttlSeconds = null) => {
    const serialized = JSON.stringify(value);
    if (ttlSeconds) {
        await client.setEx(key, ttlSeconds, serialized);
    } else {
        await client.set(key, serialized);
    }
};

/**
 * Get and parse a JSON value
 */
const getJSON = async (key) => {
    const val = await client.get(key);
    return val ? JSON.parse(val) : null;
};

/**
 * Increment with optional TTL on first set
 */
const increment = async (key, ttlSeconds = null) => {
    const count = await client.incr(key);
    if (count === 1 && ttlSeconds) {
        await client.expire(key, ttlSeconds);
    }
    return count;
};

/**
 * Cache artisan match results for a job location
 */
const cacheMatches = (lat, lng, category, matches, ttl = 120) => {
    const key = `matches:${category}:${lat.toFixed(3)}:${lng.toFixed(3)}`;
    return setJSON(key, matches, ttl);
};

const getCachedMatches = (lat, lng, category) => {
    const key = `matches:${category}:${lat.toFixed(3)}:${lng.toFixed(3)}`;
    return getJSON(key);
};

/**
 * Blacklist a JWT (on logout/ban)
 */
const blacklistToken = (jti, ttlSeconds) => {
    return client.setEx(`blacklist:${jti}`, ttlSeconds, '1');
};

const isTokenBlacklisted = async (jti) => {
    const val = await client.get(`blacklist:${jti}`);
    return val === '1';
};

module.exports = Object.assign(client, {
    setJSON,
    getJSON,
    increment,
    cacheMatches,
    getCachedMatches,
    blacklistToken,
    isTokenBlacklisted,
});