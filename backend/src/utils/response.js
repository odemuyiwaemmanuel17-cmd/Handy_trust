/**
 * HandyTrust — API Response Helpers & Custom Error Classes
 */

// ─── Response Senders ─────────────────────────────────────────────────────────

const success = (res, data, message = 'Success', statusCode = 200, meta = {}) =>
    res.status(statusCode).json({
        status: 'success',
        message,
        data,
        ...(Object.keys(meta).length && { meta }),
        timestamp: new Date().toISOString(),
    });

const created = (res, data, message = 'Created successfully') =>
    success(res, data, message, 201);

const paginated = (res, data, pagination, message = 'Success') =>
    res.status(200).json({
        status: 'success',
        message,
        data,
        pagination,
        timestamp: new Date().toISOString(),
    });

const apiError = (res, message = 'An error occurred', statusCode = 500, errors = null) => {
    const body = { status: 'error', message, timestamp: new Date().toISOString() };
    if (errors) body.errors = errors;
    return res.status(statusCode).json(body);
};

// ─── Custom Error Classes ─────────────────────────────────────────────────────

class AppError extends Error {
    constructor(message, statusCode = 500, code = 'INTERNAL_ERROR') {
        super(message);
        this.statusCode = statusCode;
        this.code = code;
        this.isOperational = true;
        Error.captureStackTrace(this, this.constructor);
    }
}

class ValidationError extends AppError {
    constructor(message, fields = null) {
        super(message, 422, 'VALIDATION_ERROR');
        this.fields = fields;
    }
}

class AuthError extends AppError {
    constructor(message = 'Authentication required') {
        super(message, 401, 'UNAUTHORIZED');
    }
}

class ForbiddenError extends AppError {
    constructor(message = 'Access denied') {
        super(message, 403, 'FORBIDDEN');
    }
}

class NotFoundError extends AppError {
    constructor(resource = 'Resource') {
        super(`${resource} not found`, 404, 'NOT_FOUND');
    }
}

class ConflictError extends AppError {
    constructor(message) {
        super(message, 409, 'CONFLICT');
    }
}

class PaymentError extends AppError {
    constructor(message) {
        super(message, 402, 'PAYMENT_ERROR');
    }
}

class RateLimitError extends AppError {
    constructor(message = 'Rate limit exceeded') {
        super(message, 429, 'RATE_LIMITED');
    }
}

// ─── Pagination Builder ───────────────────────────────────────────────────────

const buildPagination = (page, limit, total) => ({
    page: parseInt(page),
    limit: parseInt(limit),
    total,
    pages: Math.ceil(total / limit),
    hasNext: page * limit < total,
    hasPrev: page > 1,
});

module.exports = {
    success, created, paginated, apiError,
    AppError, ValidationError, AuthError, ForbiddenError,
    NotFoundError, ConflictError, PaymentError, RateLimitError,
    buildPagination,
};