'use strict';

/**
 * Shared active voice call counter per customer_id (Redis in prod, memory in dev).
 */

const voiceRedis = require('../utils/voice-redis-client');
const { resolveBackendMode } = require('../utils/clinic-rate-limiter');

const TTL_MIN = parseInt(process.env.VOICE_ACTIVE_CALL_TTL_MIN || '120', 10);
const TTL_SEC = TTL_MIN * 60;

const memoryActive = new Map();

function activeKey(customerId) {
  return `voice:active:${customerId}`;
}

function callsSetKey(customerId) {
  return `voice:active:calls:${customerId}`;
}

function logActive(event) {
  console.log(JSON.stringify({ component: 'voice_active_calls', ...event }));
}

function memoryCount(customerId) {
  const set = memoryActive.get(customerId);
  if (!set) return 0;
  return set.size;
}

function memoryAdd(customerId, callId) {
  if (!memoryActive.has(customerId)) memoryActive.set(customerId, new Set());
  const set = memoryActive.get(customerId);
  set.add(callId);
  return set.size;
}

function memoryRemove(customerId, callId) {
  const set = memoryActive.get(customerId);
  if (!set) return 0;
  set.delete(callId);
  if (set.size === 0) memoryActive.delete(customerId);
  return set ? set.size : 0;
}

async function useRedis() {
  const mode = resolveBackendMode();
  return mode === 'redis' && voiceRedis.isRedisConfigured();
}

/**
 * @returns {Promise<number>}
 */
async function getActiveCount(customerId) {
  if (!customerId) return 0;
  if (await useRedis()) {
    const client = await voiceRedis.getClient();
    const raw = await client.get(activeKey(customerId));
    return Math.max(0, parseInt(raw || '0', 10));
  }
  return memoryCount(customerId);
}

/**
 * @returns {Promise<{ allowed: boolean, active: number, max: number }>}
 */
async function checkConcurrentCapacity(customerId, maxConcurrent) {
  const max = Math.max(1, maxConcurrent || 1);
  const active = await getActiveCount(customerId);
  return {
    allowed: active < max,
    active,
    max
  };
}

/**
 * Reserve a slot before Retell register. Roll back with releaseSlot on failure.
 */
async function reserveSlot(customerId, callId, twilioCallSid = null) {
  if (!customerId || !callId) {
    return { ok: false, active: 0, reason: 'missing_ids' };
  }

  if (await useRedis()) {
    const client = await voiceRedis.getClient();
    const countKey = activeKey(customerId);
    const setKey = callsSetKey(customerId);
    const added = await client.sadd(setKey, callId);
    if (added === 0) {
      return { ok: true, active: await getActiveCount(customerId), duplicate: true };
    }
    const active = await client.incr(countKey);
    await client.expire(countKey, TTL_SEC);
    await client.expire(setKey, TTL_SEC);
    if (twilioCallSid) {
      await client.set(`voice:active:callsid:${callId}`, twilioCallSid, 'EX', TTL_SEC);
    }
    logActive({
      event: 'reserve',
      customer_id: customerId,
      call_id: callId,
      concurrent_active: active
    });
    return { ok: true, active };
  }

  const active = memoryAdd(customerId, callId);
  logActive({
    event: 'reserve',
    customer_id: customerId,
    call_id: callId,
    concurrent_active: active,
    backend: 'memory'
  });
  return { ok: true, active, backend: 'memory' };
}

async function releaseSlot(customerId, callId) {
  if (!customerId || !callId) return { active: 0 };

  if (await useRedis()) {
    const client = await voiceRedis.getClient();
    const setKey = callsSetKey(customerId);
    const removed = await client.srem(setKey, callId);
    let active = await getActiveCount(customerId);
    if (removed > 0) {
      active = await client.decr(activeKey(customerId));
      if (active < 0) {
        await client.set(activeKey(customerId), '0', 'EX', TTL_SEC);
        active = 0;
      }
    }
    await client.del(`voice:active:callsid:${callId}`);
    logActive({
      event: 'release',
      customer_id: customerId,
      call_id: callId,
      concurrent_active: Math.max(0, active)
    });
    return { active: Math.max(0, active) };
  }

  const active = memoryRemove(customerId, callId);
  logActive({
    event: 'release',
    customer_id: customerId,
    call_id: callId,
    concurrent_active: active,
    backend: 'memory'
  });
  return { active, backend: 'memory' };
}

/**
 * Persist audit row when db helpers available.
 */
function recordAdmissionAudit(db, row) {
  if (!db?.db) return;
  try {
    db.db
      .prepare(
        `INSERT OR REPLACE INTO voice_active_call_audit
         (id, customer_id, call_id, twilio_call_sid, started_at, ended_at)
         VALUES (?, ?, ?, ?, COALESCE(?, datetime('now')), ?)`
      )
      .run(
        row.id || `${row.call_id}-${Date.now()}`,
        row.customer_id,
        row.call_id,
        row.twilio_call_sid || null,
        row.started_at || null,
        row.ended_at || null
      );
  } catch (err) {
    console.warn('[voice-active-calls] audit write skipped:', err.message);
  }
}

function endAdmissionAudit(db, customerId, callId) {
  if (!db?.db) return;
  try {
    db.db
      .prepare(
        `UPDATE voice_active_call_audit SET ended_at = datetime('now')
         WHERE customer_id = ? AND call_id = ? AND ended_at IS NULL`
      )
      .run(customerId, callId);
  } catch (_) {
    /* ignore */
  }
}

module.exports = {
  getActiveCount,
  checkConcurrentCapacity,
  reserveSlot,
  releaseSlot,
  recordAdmissionAudit,
  endAdmissionAudit,
  /** @internal tests */
  _memoryActive: memoryActive
};
