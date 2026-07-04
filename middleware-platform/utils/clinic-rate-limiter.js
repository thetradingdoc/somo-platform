/**
 * Per-clinic rate limiter (Section 17)
 *
 * Tracks voice call admissions per tenant (customer_id / clinic_id).
 * Backends: in-memory (dev) or Redis (prod multi-replica).
 */

const voiceRedis = require('./voice-redis-client');

const WINDOW_MS = parseInt(process.env.CLINIC_RATE_LIMIT_WINDOW_MS || '60000', 10);
const MAX_PER_CLINIC = parseInt(process.env.CLINIC_RATE_LIMIT_MAX || '150', 10);

const memoryStore = new Map();
let maintenanceTimer = null;

function startMaintenanceTimer() {
  if (maintenanceTimer) return;
  maintenanceTimer = setInterval(() => {
    const cutoff = Date.now() - WINDOW_MS * 2;
    for (const [key, entry] of memoryStore.entries()) {
      if (entry.windowStart < cutoff) memoryStore.delete(key);
    }
  }, 5 * 60 * 1000);
  if (maintenanceTimer.unref) maintenanceTimer.unref();
}

function stopMaintenanceTimer() {
  if (maintenanceTimer) {
    clearInterval(maintenanceTimer);
    maintenanceTimer = null;
  }
}

startMaintenanceTimer();

function getWindowStart(now = Date.now()) {
  return Math.floor(now / WINDOW_MS) * WINDOW_MS;
}

function resolveBackendMode() {
  const explicit = String(process.env.VOICE_RATE_LIMIT_BACKEND || '').toLowerCase();
  if (explicit === 'redis' || explicit === 'memory') return explicit;
  return process.env.NODE_ENV === 'production' ? 'redis' : 'memory';
}

function evaluateCount(count, limit) {
  const remaining = Math.max(0, limit - count);
  return {
    allowed: count <= limit,
    remaining,
    limit,
    count
  };
}

function checkMemory(key, limitOverride) {
  const limit =
    Number.isFinite(limitOverride) && limitOverride > 0
      ? Math.floor(limitOverride)
      : MAX_PER_CLINIC;
  const now = Date.now();
  const currentWindow = getWindowStart(now);

  let entry = memoryStore.get(key);
  if (!entry) {
    entry = { count: 0, windowStart: currentWindow };
    memoryStore.set(key, entry);
  }

  if (now - entry.windowStart >= WINDOW_MS) {
    entry.count = 0;
    entry.windowStart = currentWindow;
  }

  entry.count++;
  return evaluateCount(entry.count, limit);
}

async function checkRedis(key, limitOverride) {
  const limit =
    Number.isFinite(limitOverride) && limitOverride > 0
      ? Math.floor(limitOverride)
      : MAX_PER_CLINIC;
  const client = await voiceRedis.getClient();
  if (!client) {
    throw new Error('Redis backend required but REDIS_URL is not configured');
  }

  const windowStart = getWindowStart();
  const redisKey = `voice:admission:${key}:${windowStart}`;
  const count = await client.incr(redisKey);
  if (count === 1) {
    await client.pexpire(redisKey, WINDOW_MS + 1000);
  }
  return evaluateCount(count, limit);
}

/**
 * @param {string} tenantKey
 * @param {number} [limitOverride]
 * @returns {Promise<{ allowed: boolean, remaining: number, limit: number, backend?: string }>}
 */
async function checkAsync(tenantKey, limitOverride) {
  const key = tenantKey || 'unknown';
  const mode = resolveBackendMode();
  if (mode === 'redis' && voiceRedis.isRedisConfigured()) {
    const result = await checkRedis(key, limitOverride);
    return { ...result, backend: 'redis' };
  }
  if (mode === 'redis' && !voiceRedis.isRedisConfigured()) {
    throw new Error('VOICE_RATE_LIMIT_BACKEND=redis but REDIS_URL is missing');
  }
  return { ...checkMemory(key, limitOverride), backend: 'memory' };
}

/** Sync check — memory backend only (legacy callers / tests). */
function check(tenantKey, limitOverride) {
  const key = tenantKey || 'unknown';
  return { ...checkMemory(key, limitOverride), backend: 'memory' };
}

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
    active_tenants: memoryStore.size,
    backend: resolveBackendMode()
  };
}

module.exports = {
  check,
  checkAsync,
  middleware,
  getConfig,
  resolveBackendMode,
  stopMaintenanceTimer,
  WINDOW_MS,
  MAX_PER_CLINIC,
  /** @internal tests */
  _memoryStore: memoryStore
};
