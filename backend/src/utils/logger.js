/**
 * HandyTrust — Structured Logger (Winston)
 */

const winston = require('winston');
const path = require('path');

const { combine, timestamp, printf, colorize, errors, json } = winston.format;

const devFormat = combine(
    colorize({ all: true }),
    timestamp({ format: 'HH:mm:ss' }),
    errors({ stack: true }),
    printf(({ level, message, timestamp, stack, ...meta }) => {
        let out = `${timestamp} [${level}]: ${message}`;
        if (Object.keys(meta).length) out += `  ${JSON.stringify(meta)}`;
        if (stack) out += `\n${stack}`;
        return out;
    })
);

const prodFormat = combine(timestamp(), errors({ stack: true }), json());

const transports = [new winston.transports.Console()];

if (process.env.NODE_ENV === 'production') {
    const logDir = path.join(__dirname, '../../logs');
    require('fs').mkdirSync(logDir, { recursive: true });
    transports.push(
        new winston.transports.File({ filename: path.join(logDir, 'error.log'), level: 'error', maxsize: 10_485_760, maxFiles: 5 }),
        new winston.transports.File({ filename: path.join(logDir, 'combined.log'), maxsize: 20_971_520, maxFiles: 10 })
    );
}

const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
    format: process.env.NODE_ENV === 'production' ? prodFormat : devFormat,
    transports,
    exitOnError: false,
});

module.exports = logger;