/**
 * Security Middleware
 * Adds security headers and input validation
 */

const helmet = require('helmet');

/**
 * Security headers middleware
 */
const securityHeaders = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdn.jsdelivr.net", "https://unpkg.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
      scriptSrc: ["'self'", "'unsafe-inline'", "blob:", "data:", "https://js.stripe.com", "https://accounts.google.com", "https://cdnjs.cloudflare.com", "https://cdn.jsdelivr.net", "https://unpkg.com", "https://esm.sh"], // blob/data for ElevenLabs AudioWorklets
      scriptSrcAttr: ["'unsafe-inline'"], // Allow inline event handlers (onclick, onmouseover, etc.)
      workerSrc: ["'self'", "blob:", "https://cdnjs.cloudflare.com"], // Allow PDF.js worker and blob URLs
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https://js.stripe.com", "https://api.stripe.com", "https://hooks.stripe.com", "https://api.retellai.com", "https://api.elevenlabs.io", "wss://api.elevenlabs.io", "https://api.doclittle.site", "https://api.doclittle.azurewebsites.net", "https://api.myskinandcare.com", "https://cdn.jsdelivr.net", "https://esm.sh", "https://fonts.googleapis.com", "https://*.livekit.cloud", "wss://*.livekit.cloud"],
      frameSrc: ["'self'", "https://js.stripe.com", "https://hooks.stripe.com"], // Allow Stripe iframes for card input
    },
  },
  crossOriginEmbedderPolicy: false, // Allow Stripe iframes
  crossOriginResourcePolicy: { policy: "cross-origin" }, // Allow external resources
});

/**
 * Input sanitization middleware
 */
function sanitizeInput(req, res, next) {
  // Recursively sanitize object
  function sanitize(obj) {
    if (typeof obj !== 'object' || obj === null) {
      return typeof obj === 'string' ? obj.trim() : obj;
    }

    if (Array.isArray(obj)) {
      return obj.map(sanitize);
    }

    const sanitized = {};
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        const value = obj[key];
        if (typeof value === 'string') {
          // Remove potentially dangerous characters but keep necessary ones
          sanitized[key] = value.trim().replace(/[<>]/g, '');
        } else {
          sanitized[key] = sanitize(value);
        }
      }
    }
    return sanitized;
  }

  if (req.body && typeof req.body === 'object') {
    req.body = sanitize(req.body);
  }
  if (req.query && typeof req.query === 'object') {
    req.query = sanitize(req.query);
  }
  if (req.params && typeof req.params === 'object') {
    req.params = sanitize(req.params);
  }

  next();
}

/**
 * Validate email format
 */
function validateEmail(email) {
  if (!email) return false;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Validate phone number format
 */
function validatePhone(phone) {
  if (!phone) return false;
  // Allow various formats: +1234567890, (123) 456-7890, 123-456-7890, etc.
  const phoneRegex = /^[\+]?[(]?[0-9]{1,4}[)]?[-\s\.]?[(]?[0-9]{1,4}[)]?[-\s\.]?[0-9]{1,9}$/;
  return phoneRegex.test(phone.replace(/\s/g, ''));
}

/**
 * Stable path for logs. After nested routers run, `req.path` is often just `/` (mount-relative),
 * which makes successful `GET /public/products` look like `GET / 404` in the finish line.
 */
function requestPathForLog(req) {
  if (typeof req.originalUrl === 'string' && req.originalUrl.length) {
    const q = req.originalUrl.indexOf('?');
    return q === -1 ? req.originalUrl : req.originalUrl.slice(0, q);
  }
  const base = req.baseUrl || '';
  const p = req.path || '';
  return (base + p) || '/';
}

/**
 * Request logging middleware (basic console logging)
 * For database logging, use usageLogger from usage-logger.js
 */
function requestLogger(req, res, next) {
  const start = Date.now();
  const pathLog = requestPathForLog(req);

  // Log request
  console.log(`[${new Date().toISOString()}] ${req.method} ${pathLog} - IP: ${req.ip}`);

  // Log response when finished
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`[${new Date().toISOString()}] ${req.method} ${pathLog} ${res.statusCode} - ${duration}ms`);
  });

  next();
}

module.exports = {
  securityHeaders,
  sanitizeInput,
  validateEmail,
  validatePhone,
  requestLogger
};

