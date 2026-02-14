/**
 * Per-clinic rate limiter (Section 17)
 *
 * Tracks Retell webhook / voice calls per clinic_id (or agent_id as fallback).
 * Prevents runaway clinics from exhausting capacity.
 */

const WINDOW_MS = parseInt(process.env.CLINIC_RATE_LIMIT_WINDOW_MS || '60000', 10); // 1 min
const MAX_PER_CLINIC = parseInt(process.env.CLINIC_RATE_LIMIT_MAX || '150', 10); // 150 req/min per clinic

const store = new Map(); // key -> { count, windowStart }

function getWindowStart() {
  return Math.floor(Date.now() / WINDOW_MS) * WINDOW_MS;
}

/**
 * Check if request is allowed for this tenant (clinic_id, customer_id, or agent_id).
 * @param {string} tenantKey - clinic_id, customer_id, or agent_id
 * @returns {{ allowed: boolean, remaining: number, limit: number }}
 */
function check(tenantKey) {
  const key = tenantKey || 'unknown';
  const now = Date.now();
  const currentWindow = getWindowStart();

  let entry = store.get(key);
  if (!entry) {
    entry = { count: 0, windowStart: currentWindow };
    store.set(key, entry);
  }

  // Reset if we're in a new window
  if (now - entry.windowStart >= WINDOW_MS) {
    entry.count = 0;
    entry.windowStart = currentWindow;
  }

  entry.count++;
  const remaining = Math.max(0, MAX_PER_CLINIC - entry.count);
  const allowed = entry.count <= MAX_PER_CLINIC;

  return { allowed, remaining, limit: MAX_PER_CLINIC };
}

/**
 * Express middleware: extract tenant from req and enforce limit.
 * Expects req.clinic_id, req.customer_id, or req.agent_id to be set by upstream.
 */
function middleware(req, res, next) {
  const key = req.clinic_id || req.customer_id || req.agent_id || req.ip;
  const result = check(key);
  if (!result.allowed) {
    return res.status(429).json({
      error: 'Clinic rate limit exceeded',
      retryAfter: Math.ceil(WINDOW_MS / 1000)
    });
  }
  res.setHeader('X-RateLimit-Remaining', result.remaining);
  res.setHeader('X-RateLimit-Limit', result.limit);
  next();
}

function getConfig() {
  return {
    window_ms: WINDOW_MS,
    max_per_clinic: MAX_PER_CLINIC,
    active_tenants: store.size
  };
}

// Periodic cleanup of stale entries (every 5 min)
setInterval(() => {
  const cutoff = Date.now() - WINDOW_MS * 2;
  for (const [key, entry] of store.entries()) {
    if (entry.windowStart < cutoff) store.delete(key);
  }
}, 5 * 60 * 1000);

module.exports = {
  check,
  middleware,
  getConfig,
  WINDOW_MS,
  MAX_PER_CLINIC
};
