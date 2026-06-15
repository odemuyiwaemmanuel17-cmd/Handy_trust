/**
 * HandyTrust — Authentication & Authorization Middleware
 */

const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { query } = require('../config/database');
const { AuthError, ForbiddenError } = require('../utils/response');
const logger = require('../utils/logger');

/**
 * Verify JWT access token — attaches req.user
 */
const authenticate = async (req, res, next) => {
    try {
        const header = req.headers.authorization;
        if (!header?.startsWith('Bearer ')) throw new AuthError('No access token provided');

        const token = header.split(' ')[1];
        let decoded;
        try {
            decoded = jwt.verify(token, process.env.JWT_SECRET);
        } catch (e) {
            if (e.name === 'TokenExpiredError') throw new AuthError('Access token has expired');
            throw new AuthError('Invalid access token');
        }

        const { rows } = await query(
            `SELECT id, full_name, phone, email, role, status, avatar_url,
              whatsapp_enabled, push_token, wallet_balance
       FROM users WHERE id = $1`,
            [decoded.sub]
        );
        if (!rows.length) throw new AuthError('User not found');

        const user = rows[0];
        if (user.status === 'banned') throw new ForbiddenError('Account has been banned');
        if (user.status === 'suspended') throw new ForbiddenError('Account is suspended');

        // Non-blocking last_seen update
        query('UPDATE users SET last_seen_at = NOW() WHERE id = $1', [user.id]).catch(() => { });

        req.user = user;
        next();
    } catch (err) {
        next(err);
    }
};

/**
 * Attach user if token present — never throws
 */
const optionalAuth = async (req, res, next) => {
    try {
        const header = req.headers.authorization;
        if (header?.startsWith('Bearer ')) {
            const token = header.split(' ')[1];
            try {
                const decoded = jwt.verify(token, process.env.JWT_SECRET);
                const { rows } = await query('SELECT * FROM users WHERE id = $1', [decoded.sub]);
                if (rows.length) req.user = rows[0];
            } catch (_) { }
        }
        next();
    } catch (err) {
        next(err);
    }
};

/**
 * Role-based authorization guard
 * Usage: authorize('admin', 'support')
 */
const authorize = (...roles) => (req, _res, next) => {
    if (!req.user) return next(new AuthError());
    if (!roles.includes(req.user.role)) {
        logger.warn('Role access denied', { userId: req.user.id, role: req.user.role, required: roles });
        return next(new ForbiddenError(`Requires role: ${roles.join(' or ')}`));
    }
    next();
};

/**
 * Ensure phone is verified before sensitive actions
 */
const requireVerifiedPhone = (req, _res, next) => {
    if (!req.user) return next(new AuthError());
    if (req.user.status === 'pending_verification') {
        return next(new ForbiddenError('Phone verification required'));
    }
    next();
};

/**
 * Ensure requesting user owns the resource — or is admin
 */
const requireOwnership = (getResourceUserId) => (req, _res, next) => {
    const resourceOwner = getResourceUserId(req);
    if (req.user.id !== resourceOwner && req.user.role !== 'admin') {
        return next(new ForbiddenError('You do not own this resource'));
    }
    next();
};

/**
 * Generate access + refresh token pair
 */
const generateTokens = (userId, role) => {
    const accessToken = jwt.sign(
        { sub: userId, role, type: 'access' },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );
    const refreshToken = jwt.sign(
        { sub: userId, type: 'refresh' },
        process.env.JWT_REFRESH_SECRET,
        { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d' }
    );
    return { accessToken, refreshToken };
};

/**
 * Persist refresh token hash to DB
 */
const storeRefreshToken = async (userId, token, req) => {
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await query(
        `INSERT INTO refresh_tokens (user_id, token_hash, device_info, ip_address, expires_at)
     VALUES ($1,$2,$3,$4,$5)`,
        [userId, hash, req.headers['user-agent'] || null, req.ip || null, expiresAt]
    );
};

module.exports = {
    authenticate, optionalAuth, authorize,
    requireVerifiedPhone, requireOwnership,
    generateTokens, storeRefreshToken,
};