'use strict';

/**
 * Lazy Redis client for voice rate limits and active-call counters.
 * Production voice limits require REDIS_URL when VOICE_RATE_LIMIT_BACKEND=redis.
 */

let _client = null;
let _connectPromise = null;

function isRedisBackendRequired() {
  const backend = String(process.env.VOICE_RATE_LIMIT_BACKEND || '').toLowerCase();
  if (backend === 'redis') return true;
  if (backend === 'memory') return false;
  return process.env.NODE_ENV === 'production';
}

function getRedisUrl() {
  return process.env.REDIS_URL || process.env.VOICE_REDIS_URL || null;
}

function isRedisConfigured() {
  return !!getRedisUrl();
}

async function getClient() {
  if (!isRedisConfigured()) return null;
  if (_client) return _client;

  if (!_connectPromise) {
    _connectPromise = (async () => {
      const Redis = require('ioredis');
      const url = getRedisUrl();
      const client = new Redis(url, {
        maxRetriesPerRequest: 2,
        enableReadyCheck: true,
        lazyConnect: true,
        connectTimeout: 5000
      });
      await client.connect();
      client.on('error', (err) => {
        console.warn('[voice-redis] connection error:', err.message);
      });
      _client = client;
      return client;
    })().catch((err) => {
      _connectPromise = null;
      throw err;
    });
  }

  return _connectPromise;
}

async function ping() {
  const client = await getClient();
  if (!client) {
    return { ok: false, configured: false, error: 'REDIS_URL not set' };
  }
  const start = Date.now();
  try {
    const pong = await client.ping();
    return {
      ok: pong === 'PONG',
      configured: true,
      latencyMs: Date.now() - start
    };
  } catch (err) {
    return { ok: false, configured: true, error: err.message, latencyMs: Date.now() - start };
  }
}

async function closeClient() {
  if (_client) {
    try {
      await _client.quit();
    } catch (_) {
      /* ignore */
    }
    _client = null;
    _connectPromise = null;
  }
}

module.exports = {
  getClient,
  ping,
  closeClient,
  isRedisConfigured,
  isRedisBackendRequired,
  getRedisUrl
};
