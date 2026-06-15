/**
 * HandyTrust — Main Server Bootstrap
 * Express + Socket.IO + all middleware
 */

require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const routes = require('./routes/index');
const { errorHandler, notFound } = require('./middleware/errorHandler');
const logger = require('./utils/logger');
const { checkHealth } = require('./config/database');
const redisClient = require('./config/redis');
const initSocket = require('./socket');

const app = express();
const server = http.createServer(app);

// ─── Socket.IO ───────────────────────────────────────────────────────────────
const io = new Server(server, {
    cors: {
        origin: process.env.FRONTEND_URL || '*',
        methods: ['GET', 'POST'],
        credentials: true,
    },
    pingTimeout: 30000,
    pingInterval: 10000,
});
initSocket(io);
app.set('io', io);

// ─── Security Middleware ──────────────────────────────────────────────────────
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", 'data:', 'https:'],
        },
    },
    crossOriginEmbedderPolicy: false,
}));

app.use(cors({
    origin: process.env.FRONTEND_URL || '*',
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
}));

// ─── Global Rate Limiter ──────────────────────────────────────────────────────
app.use(rateLimit({
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
    max: parseInt(process.env.RATE_LIMIT_MAX) || 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { status: 'error', message: 'Too many requests. Please slow down.' },
    skip: (req) => req.path === '/api/v1/health',
}));

// ─── Body Parsing ─────────────────────────────────────────────────────────────
// Raw body for webhook signature verification (must come before json parser)
app.use('/api/v1/webhooks', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ─── Compression & Logging ────────────────────────────────────────────────────
app.use(compression());

if (process.env.NODE_ENV !== 'test') {
    app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev', {
        stream: { write: (msg) => logger.http(msg.trim()) },
        skip: (req) => req.path === '/api/v1/health',
    }));
}

// ─── Trust Proxy (for accurate IPs behind nginx/load balancer) ───────────────
app.set('trust proxy', 1);

// ─── API Routes ───────────────────────────────────────────────────────────────
const API_PREFIX = `/api/${process.env.API_VERSION || 'v1'}`;
app.use(API_PREFIX, routes);

// ─── 404 & Error Handler ──────────────────────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

// ─── Server Startup ───────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT) || 5000;

async function startServer() {
    try {
        // Verify DB connection
        const dbHealth = await checkHealth();
        if (!dbHealth.healthy) {
            throw new Error(`Database connection failed: ${dbHealth.error}`);
        }
        logger.info('✅ Database connected', { timestamp: dbHealth.timestamp });

        // Verify Redis connection
        await redisClient.ping();
        logger.info('✅ Redis connected');

        server.listen(PORT, () => {
            logger.info(`🚀 HandyTrust API running on port ${PORT}`, {
                environment: process.env.NODE_ENV,
                version: process.env.npm_package_version || '1.0.0',
                prefix: API_PREFIX,
            });
        });
    } catch (err) {
        logger.error('❌ Server startup failed', { error: err.message });
        process.exit(1);
    }
}

// ─── Graceful Shutdown ────────────────────────────────────────────────────────
const shutdown = (signal) => {
    logger.info(`${signal} received — shutting down gracefully`);
    server.close(async () => {
        await redisClient.quit();
        const { pool } = require('./config/database');
        await pool.end();
        logger.info('Server shut down cleanly');
        process.exit(0);
    });
    setTimeout(() => { logger.error('Forced shutdown'); process.exit(1); }, 10000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled Promise Rejection', { reason: reason?.message || reason });
});
process.on('uncaughtException', (err) => {
    logger.error('Uncaught Exception', { error: err.message, stack: err.stack });
    process.exit(1);
});

startServer();

module.exports = { app, server };