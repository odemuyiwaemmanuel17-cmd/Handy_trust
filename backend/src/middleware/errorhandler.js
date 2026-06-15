/**
 * HandyTrust — Global Error Handler
 */

const logger = require('../utils/logger');

const errorHandler = (err, req, res, next) => {
    let { statusCode = 500, message = 'Internal server error', code = 'INTERNAL_ERROR' } = err;

    // PostgreSQL constraint errors
    if (err.code === '23505') { statusCode = 409; code = 'DUPLICATE_ENTRY'; message = _extractDuplicateField(err.detail); }
    else if (err.code === '23503') { statusCode = 422; code = 'REFERENCE_ERROR'; message = 'Referenced record does not exist'; }
    else if (err.code === '23502') { statusCode = 422; code = 'MISSING_FIELD'; message = 'A required field is missing'; }

    // JWT errors
    if (err.name === 'JsonWebTokenError') { statusCode = 401; code = 'INVALID_TOKEN'; message = 'Invalid token'; }

    // Multer errors
    if (err.code === 'LIMIT_FILE_SIZE') { statusCode = 413; code = 'FILE_TOO_LARGE'; message = 'File exceeds 25MB limit'; }

    // Log unexpected errors
    if (!err.isOperational || statusCode >= 500) {
        logger.error('Unhandled error', {
            message: err.message, stack: err.stack,
            path: req.path, method: req.method, userId: req.user?.id,
        });
    }

    const body = { status: 'error', code, message, timestamp: new Date().toISOString() };
    if (err.fields) body.fields = err.fields;
    if (process.env.NODE_ENV === 'development') body.stack = err.stack;

    res.status(statusCode).json(body);
};

const notFound = (req, res) =>
    res.status(404).json({
        status: 'error', code: 'NOT_FOUND',
        message: `Cannot ${req.method} ${req.path}`,
        timestamp: new Date().toISOString(),
    });

const _extractDuplicateField = (detail) => {
    if (!detail) return 'A record with this value already exists';
    const m = detail.match(/Key \((.+?)\)/);
    return m ? `${m[1].replace(/_/g, ' ')} is already taken` : 'A record with this value already exists';
};

module.exports = { errorHandler, notFound };