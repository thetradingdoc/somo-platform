/**
 * In-memory TTL cache for medical coding lookups.
 * Phase 3.3: Reduces DB/file reads for frequent queries.
 *
 * Buckets:
 * - code_lookup: ICD-10, CPT, HCPCS search results (TTL 24h)
 * - payer_guidelines: hasFeeScheduleForPayer results (TTL 7 days)
 * - payer_pricing: getAllowedAmountsForCodes results (TTL 24h)
 * - coding_rules: code-pair-validation rules (TTL 30 days)
 *
 * Logs cache hit/miss for tuning. Redis can be added later for production.
 */

const MS_PER_MINUTE = 60 * 1000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;
const MS_PER_WEEK = 7 * MS_PER_DAY;
const MS_30_DAYS = 30 * MS_PER_DAY;

const BUCKETS = {
  code_lookup: MS_PER_DAY,      // 24h
  payer_guidelines: MS_PER_WEEK, // 7 days
  payer_pricing: MS_PER_DAY,     // 24h
  coding_rules: MS_30_DAYS,      // 30 days
  code_acceptance: MS_PER_HOUR,  // 1h - Tiba φ^historical
  slot_availability: 5 * MS_PER_MINUTE // 5 min - call duration optimization
};

const store = new Map(); // key -> { value, expiresAt }
let stats = { hits: 0, misses: 0 };

// Prevent unbounded heap growth from high-cardinality keys (e.g. slot availability).
// TTL alone isn't enough because we don't purge unless the specific key is read.
const MAX_STORE_ENTRIES = parseInt(process.env.CACHE_MAX_ENTRIES || '5000', 10);
const PURGE_EVERY_MS = parseInt(process.env.CACHE_PURGE_EVERY_MS || String(60 * 1000), 10);
let lastPurgeAt = 0;

function purgeExpired() {
  const now = Date.now();
  for (const [k, entry] of store.entries()) {
    if (!entry || entry.expiresAt <= now) store.delete(k);
  }
}

function purgeExpiredIfDue() {
  const now = Date.now();
  if (now - lastPurgeAt >= PURGE_EVERY_MS) {
    lastPurgeAt = now;
    purgeExpired();
  }
}

function ensureCapacity() {
  purgeExpiredIfDue();
  if (store.size <= MAX_STORE_ENTRIES) return;

  // Evict entries with the earliest expiration first.
  // (O(n^2) worst case, but store is capped and TTL purge reduces churn.)
  while (store.size > MAX_STORE_ENTRIES) {
    let oldestKey = null;
    let oldestExpiresAt = Infinity;
    for (const [k, entry] of store.entries()) {
      const expiresAt = entry?.expiresAt ?? Infinity;
      if (expiresAt < oldestExpiresAt) {
        oldestExpiresAt = expiresAt;
        oldestKey = k;
      }
    }
    if (!oldestKey) break;
    store.delete(oldestKey);
  }
}

function makeKey(bucket, ...parts) {
  const normalized = parts.map(p => (p == null ? '' : String(p).trim())).join(':');
  return `${bucket}:${normalized}`;
}

function get(bucket, ...keyParts) {
  purgeExpiredIfDue();
  const key = makeKey(bucket, ...keyParts);
  const entry = store.get(key);
  if (!entry) {
    stats.misses++;
    if (process.env.LOG_CACHE_MISS === '1') {
      console.log(`[cache MISS] ${key}`);
    }
    return null;
  }
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    stats.misses++;
    return null;
  }
  stats.hits++;
  return entry.value;
}

function set(bucket, value, ...keyParts) {
  ensureCapacity();
  const key = makeKey(bucket, ...keyParts);
  const ttl = BUCKETS[bucket] ?? MS_PER_DAY;
  store.set(key, {
    value,
    expiresAt: Date.now() + ttl
  });
}

function getStats() {
  return { ...stats, size: store.size };
}

function resetStats() {
  stats = { hits: 0, misses: 0 };
}

function clear(bucket) {
  if (!bucket) {
    store.clear();
    return;
  }
  const prefix = `${bucket}:`;
  for (const k of store.keys()) {
    if (k.startsWith(prefix)) store.delete(k);
  }
}

/**
 * Warm cache on startup (Section 24): preload common code lookups
 */
function warm() {
  try {
    const ks = require('./knowledge-service');
    const notes = ['office visit', 'evaluation and management', 'therapy session', 'annual wellness'];
    for (const note of notes) {
      try {
        if (ks.getCandidateCptCodes) ks.getCandidateCptCodes(note, { limit: 10 });
        // MT-03: global warmup only — no clinicId (allows untagged codebook vectors).
        const fetchOpts = { maxIcd10: 5, maxCpt: 5 };
        if (typeof ks.getCodeCandidatesDualSource === 'function') {
          ks.getCodeCandidatesDualSource(note, fetchOpts).catch(() => {});
        } else if (ks.getCodeCandidates) {
          ks.getCodeCandidates(note, fetchOpts).catch(() => {});
        }
      } catch (_) { /* skip */ }
    }
    if (ks.loadModifierRules) ks.loadModifierRules();
    console.log(`✅ Cache warmed: ${getStats().size} entries`);
  } catch (e) {
    console.warn('⚠️  Cache warm failed:', e.message);
  }
}

// Periodically purge expired entries to keep heap stable even if a workload stops
// touching older keys.
setInterval(() => purgeExpiredIfDue(), PURGE_EVERY_MS).unref?.();

module.exports = {
  get,
  set,
  getStats,
  resetStats,
  clear,
  warm,
  BUCKETS,
  makeKey
};
