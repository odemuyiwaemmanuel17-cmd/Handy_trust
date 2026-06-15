/**
 * HandyTrust — Granular Rate Limiters
 */

const rateLimit = require('express-rate-limit');
const redis = require('../config/redis');

const makeOptions = (windowMs, max, message) => ({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { status: 'error', code: 'RATE_LIMITED', message },
});

/** 20 attempts per 15 min — login / register */
const authLimiter = rateLimit(makeOptions(
    15 * 60 * 1000, 20,
    'Too many auth requests. Please wait 15 minutes.'
));

/** 3 OTPs per minute */
const otpLimiter = rateLimit(makeOptions(
    60 * 1000, 3,
    'Too many OTP requests. Please wait 1 minute.'
));

/** 5 job reports per 10 min */
const jobReportLimiter = rateLimit(makeOptions(
    10 * 60 * 1000, 5,
    'Too many job reports. Please wait a few minutes.'
));

/** 20 file uploads per minute */
const uploadLimiter = rateLimit(makeOptions(
    60 * 1000, 20,
    'Upload rate limit exceeded.'
));

/** 10 payment initiations per 5 min */
const paymentLimiter = rateLimit(makeOptions(
    5 * 60 * 1000, 10,
    'Too many payment requests. Please slow down.'
));

module.exports = { authLimiter, otpLimiter, jobReportLimiter, uploadLimiter, paymentLimiter };