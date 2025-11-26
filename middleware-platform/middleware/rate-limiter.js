/**
 * Rate Limiting Middleware
 * Protects API endpoints from abuse and DDoS attacks
 */

const rateLimit = require('express-rate-limit');

// Custom key generator that handles IP addresses with ports and trust proxy
const keyGenerator = (req) => {
  // Extract IP from req.ip, removing port if present
  let ip = req.ip || req.connection?.remoteAddress || 'unknown';
  
  // Remove port number if present (e.g., "54.196.252.50:54288" -> "54.196.252.50")
  if (ip && ip.includes(':')) {
    // Handle IPv6 addresses (e.g., "::ffff:169.254.130.1")
    if (ip.startsWith('::ffff:')) {
      ip = ip.replace('::ffff:', '');
    }
    // Remove port number
    const parts = ip.split(':');
    ip = parts[0];
  }
  
  return ip || 'unknown';
};

// General API rate limiter
// Note: trust proxy must be set in server.js before this middleware is used
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: {
    error: 'Too many requests from this IP, please try again later.',
    retryAfter: '15 minutes'
  },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  keyGenerator, // Custom key generator to handle IP addresses with ports
  validate: {
    trustProxy: false, // Disable trust proxy validation
    ip: false // Disable IP validation to handle IPs with ports
  }
});

// Strict rate limiter for sensitive endpoints
const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Limit each IP to 10 requests per windowMs
  message: {
    error: 'Too many requests from this IP, please try again later.',
    retryAfter: '15 minutes'
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator, // Custom key generator to handle IP addresses with ports
  validate: {
    trustProxy: false, // Disable trust proxy validation
    ip: false // Disable IP validation to handle IPs with ports
  }
});

// Authentication endpoints (login, signup, verification)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 auth attempts per windowMs
  message: {
    error: 'Too many authentication attempts, please try again later.',
    retryAfter: '15 minutes'
  },
  skipSuccessfulRequests: true, // Don't count successful requests
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator, // Custom key generator to handle IP addresses with ports
  validate: {
    trustProxy: false, // Disable trust proxy validation
    ip: false // Disable IP validation to handle IPs with ports
  }
});

// Payment endpoints - very strict
const paymentLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // Limit each IP to 10 payment requests per hour
  message: {
    error: 'Too many payment requests, please try again later.',
    retryAfter: '1 hour'
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator, // Custom key generator to handle IP addresses with ports
  validate: {
    trustProxy: false, // Disable trust proxy validation
    ip: false // Disable IP validation to handle IPs with ports
  }
});

// Voice endpoints - moderate
const voiceLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 20, // Limit each IP to 20 voice requests per minute
  message: {
    error: 'Too many voice requests, please try again later.',
    retryAfter: '1 minute'
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator, // Custom key generator to handle IP addresses with ports
  validate: {
    trustProxy: false, // Disable trust proxy validation
    ip: false // Disable IP validation to handle IPs with ports
  }
});

module.exports = {
  apiLimiter,
  strictLimiter,
  authLimiter,
  paymentLimiter,
  voiceLimiter
};

