'use strict';

/**
 * Voice limit service — call_admission (inbound only) vs turn_rate_limit (WS abuse guard).
 */

const { checkAsync, check, getConfig, resolveBackendMode } = require('../utils/clinic-rate-limiter');
const voiceRedis = require('../utils/voice-redis-client');

const TURN_WINDOW_MS = parseInt(process.env.VOICE_TURN_RATE_LIMIT_WINDOW_MS || '60000', 10);
const TURN_MAX = parseInt(process.env.VOICE_TURN_RATE_LIMIT_MAX || '120', 10);
const ADMISSION_DEDUPE_TTL_SEC = parseInt(process.env.VOICE_ADMISSION_DEDUPE_TTL_SEC || '300', 10);

const turnStore = new Map();

function logVoiceLimit(event) {
  console.log(JSON.stringify({ component: 'voice_limit', ...event }));
}

function getTurnWindowStart(now = Date.now()) {
  return Math.floor(now / TURN_WINDOW_MS) * TURN_WINDOW_MS;
}

/**
 * @param {{ customerId?: string, tenantKey?: string, tierLimit?: number }} opts
 */
async function checkCallAdmission(opts = {}) {
  const tenantKey = opts.customerId || opts.tenantKey || 'unknown';
  const result = await checkAsync(tenantKey, opts.tierLimit);
  logVoiceLimit({
    limit_type: 'call_admission',
    customer_id: opts.customerId || null,
    tenant_key: tenantKey,
    rate_limit_outcome: result.allowed ? 'allowed' : 'rejected',
    remaining: result.remaining,
    limit: result.limit,
    backend: result.backend
  });
  return result;
}

/** Sync admission check for tests and legacy paths. */
function checkCallAdmissionSync(opts = {}) {
  const tenantKey = opts.customerId || opts.tenantKey || 'unknown';
  return check(tenantKey, opts.tierLimit);
}

/**
 * High-ceiling per-callId turn abuse guard (in-memory per process is acceptable).
 * @param {{ callId: string }} opts
 */
function checkTurnRateLimit(opts = {}) {
  const callId = opts.callId || 'unknown';
  const now = Date.now();
  const windowStart = getTurnWindowStart(now);

  let entry = turnStore.get(callId);
  if (!entry || now - entry.windowStart >= TURN_WINDOW_MS) {
    entry = { count: 0, windowStart };
    turnStore.set(callId, entry);
  }

  entry.count++;
  const allowed = entry.count <= TURN_MAX;
  const result = {
    allowed,
    remaining: Math.max(0, TURN_MAX - entry.count),
    limit: TURN_MAX,
    limit_type: 'turn_rate_limit'
  };

  if (!allowed) {
    logVoiceLimit({
      limit_type: 'turn_rate_limit',
      call_id: callId,
      rate_limit_outcome: 'rejected',
      count: entry.count,
      limit: TURN_MAX
    });
  }

  return result;
}

function clearTurnRateLimit(callId) {
  if (callId) turnStore.delete(callId);
}

async function getCachedInboundCall(callSid) {
  if (!callSid) return null;
  if (voiceRedis.isRedisConfigured()) {
    try {
      const client = await voiceRedis.getClient();
      const raw = await client.get(`voice:inbound:cache:${callSid}`);
      if (raw) return JSON.parse(raw);
    } catch (_) {
      /* ignore */
    }
  }
  if (!getCachedInboundCall._memory) getCachedInboundCall._memory = new Map();
  return getCachedInboundCall._memory.get(callSid) || null;
}

async function cacheInboundCall(callSid, payload) {
  if (!callSid || !payload) return;
  const ttl = ADMISSION_DEDUPE_TTL_SEC;
  if (voiceRedis.isRedisConfigured()) {
    try {
      const client = await voiceRedis.getClient();
      await client.set(`voice:inbound:cache:${callSid}`, JSON.stringify(payload), 'EX', ttl);
    } catch (_) {
      /* ignore */
    }
  }
  if (!getCachedInboundCall._memory) getCachedInboundCall._memory = new Map();
  getCachedInboundCall._memory.set(callSid, payload);
  setTimeout(() => getCachedInboundCall._memory.delete(callSid), ttl * 1000);
}

/**
 * Twilio CallSid dedupe — true when this CallSid was already processed recently.
 */
async function checkCallSidDedupe(callSid) {
  const cached = await getCachedInboundCall(callSid);
  if (cached) return { duplicate: true, cached: true, payload: cached };
  return { duplicate: false };
}

function getLimitBackendStatus() {
  return {
    admission_backend: resolveBackendMode(),
    redis_configured: voiceRedis.isRedisConfigured(),
    redis_required: voiceRedis.isRedisBackendRequired(),
    turn_limit_max: TURN_MAX,
    turn_window_ms: TURN_WINDOW_MS,
    admission: getConfig()
  };
}

setInterval(() => {
  const cutoff = Date.now() - TURN_WINDOW_MS * 2;
  for (const [key, entry] of turnStore.entries()) {
    if (entry.windowStart < cutoff) turnStore.delete(key);
  }
}, 5 * 60 * 1000);

module.exports = {
  checkCallAdmission,
  checkCallAdmissionSync,
  checkTurnRateLimit,
  clearTurnRateLimit,
  checkCallSidDedupe,
  cacheInboundCall,
  getCachedInboundCall,
  markCallSidAdmitted: cacheInboundCall,
  getLimitBackendStatus,
  TURN_MAX,
  TURN_WINDOW_MS
};
