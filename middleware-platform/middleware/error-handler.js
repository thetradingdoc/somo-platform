/**
 * Comprehensive Error Handler Middleware
 * Prevents crashes and ensures graceful error handling
 */

const db = require('../database');

// Track error rates for circuit breaker pattern
const errorCounts = new Map();
const ERROR_THRESHOLD = 100; // Max errors per minute
const ERROR_WINDOW = 60000; // 1 minute window

/**
 * Log error to database and console
 */
function logError(error, req = null, context = {}) {
  const errorInfo = {
    message: error.message,
    stack: error.stack,
    name: error.name,
    code: error.code,
    path: req?.path,
    method: req?.method,
    ip: req?.ip,
    userAgent: req?.get('user-agent'),
    timestamp: new Date().toISOString(),
    context: JSON.stringify(context)
  };

  // Log to console with context
  console.error('❌ ERROR:', {
    message: error.message,
    path: req?.path,
    method: req?.method,
    context
  });

  // Log to database (async, don't block)
  setImmediate(() => {
    try {
      if (db && db.logError) {
        db.logError(errorInfo);
      }
    } catch (dbError) {
      console.error('⚠️  Failed to log error to database:', dbError.message);
    }
  });

  // Track error rate
  const now = Date.now();
  const key = `${req?.path || 'unknown'}:${now - (now % ERROR_WINDOW)}`;
  const count = (errorCounts.get(key) || 0) + 1;
  errorCounts.set(key, count);

  // Clean old entries
  if (errorCounts.size > 100) {
    const cutoff = now - ERROR_WINDOW;
    for (const [k] of errorCounts) {
      const timestamp = parseInt(k.split(':')[1]);
      if (timestamp < cutoff) {
        errorCounts.delete(k);
      }
    }
  }
}

/**
 * Check if error rate is too high (circuit breaker)
 */
function isErrorRateTooHigh() {
  const now = Date.now();
  const windowStart = now - (now % ERROR_WINDOW);
  const key = `global:${windowStart}`;
  const count = errorCounts.get(key) || 0;
  return count > ERROR_THRESHOLD;
}

/**
 * Express error handler middleware
 */
function errorHandler(err, req, res, next) {
  // Log the error
  logError(err, req, { 
    body: req.body,
    query: req.query,
    params: req.params 
  });

  // Don't expose stack traces in production
  const isDevelopment = process.env.NODE_ENV === 'development';
  
  // Handle specific error types
  if (err.name === 'ValidationError') {
    return res.status(400).json({
      success: false,
      error: 'Validation Error',
      message: err.message,
      details: isDevelopment ? err.details : undefined
    });
  }

  if (err.name === 'UnauthorizedError' || err.status === 401) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized',
      message: 'Authentication required'
    });
  }

  if (err.name === 'RateLimitError') {
    return res.status(429).json({
      success: false,
      error: 'Rate Limit Exceeded',
      message: 'Too many requests. Please try again later.'
    });
  }

  // Database errors
  if (err.code && err.code.startsWith('SQLITE_')) {
    console.error('❌ Database error:', err.message);
    return res.status(503).json({
      success: false,
      error: 'Database Error',
      message: 'A database error occurred. Please try again.',
      retry: true
    });
  }

  // Check if error rate is too high
  if (isErrorRateTooHigh()) {
    console.error('🚨 ERROR RATE TOO HIGH - Entering circuit breaker mode');
    return res.status(503).json({
      success: false,
      error: 'Service Temporarily Unavailable',
      message: 'High error rate detected. Please try again in a moment.',
      retryAfter: 60
    });
  }

  // Default error response
  const statusCode = err.statusCode || err.status || 500;
  res.status(statusCode).json({
    success: false,
    error: err.message || 'Internal Server Error',
    ...(isDevelopment && { stack: err.stack, details: err })
  });
}

/**
 * Async error wrapper for route handlers
 */
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * Timeout wrapper for long-running operations
 */
function withTimeout(fn, timeoutMs = 30000) {
  return async (...args) => {
    let timer;
    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`Operation timed out after ${timeoutMs}ms`)),
        timeoutMs
      );
    });
    return Promise.race([fn(...args), timeoutPromise]).finally(() => {
      if (timer) clearTimeout(timer);
    });
  };
}

/**
 * Retry wrapper with exponential backoff
 */
async function withRetry(fn, maxRetries = 3, delayMs = 1000) {
  let lastError;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < maxRetries - 1) {
        const delay = delayMs * Math.pow(2, attempt);
        console.warn(`⚠️  Retry attempt ${attempt + 1}/${maxRetries} after ${delay}ms`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError;
}

/**
 * Memory monitoring
 */
function checkMemoryUsage() {
  const usage = process.memoryUsage();
  const heapUsedMB = usage.heapUsed / 1024 / 1024;
  const heapTotalMB = usage.heapTotal / 1024 / 1024;
  const rssMB = usage.rss / 1024 / 1024;

  // Warn if memory usage is high
  if (heapUsedMB > 500) {
    console.warn(`⚠️  High memory usage: ${heapUsedMB.toFixed(2)}MB / ${heapTotalMB.toFixed(2)}MB (RSS: ${rssMB.toFixed(2)}MB)`);
  }

  // Force garbage collection if available
  if (global.gc && heapUsedMB > 400) {
    console.log('🧹 Running garbage collection...');
    global.gc();
  }

  return { heapUsedMB, heapTotalMB, rssMB };
}

// Monitor memory every 5 minutes
if (process.env.NODE_ENV === 'production') {
  setInterval(checkMemoryUsage, 5 * 60 * 1000);
}

module.exports = {
  errorHandler,
  asyncHandler,
  withTimeout,
  withRetry,
  logError,
  checkMemoryUsage,
  isErrorRateTooHigh
};


