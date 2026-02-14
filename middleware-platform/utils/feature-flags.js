/**
 * Feature flags with optional DB-backed overrides (Section 15)
 * Checks config/feature-flags.js first; if feature_flags table exists, overrides from DB.
 * Supports rollout_pct for gradual rollout.
 */

const configFlags = require('../config/feature-flags');
const CACHE_TTL_MS = 60000;
let db = null;
let cache = {};
let cacheExpiry = 0;

function getDb() {
  if (!db) {
    try {
      db = require('../database');
    } catch (_) {
      db = null;
    }
  }
  return db;
}

function getFromDb(flagName, clinicId, callId) {
  const d = getDb();
  if (!d?.db) return null;
  try {
    const row = d.db.prepare(`
      SELECT enabled_globally, enabled_for_clinic_ids, rollout_pct
      FROM feature_flags WHERE flag_name = ?
    `).get(flagName);
    return row;
  } catch (_) {
    return null;
  }
}

function isEnabled(flagName, clinicId = null, callId = null) {
  const configVal = configFlags.flags[flagName];
  if (configVal === undefined) return false;

  const now = Date.now();
  if (now > cacheExpiry) {
    cache = {};
    cacheExpiry = now + CACHE_TTL_MS;
  }
  const cacheKey = `${flagName}:${clinicId || ''}:${callId || ''}`;
  if (cache[cacheKey] !== undefined) return cache[cacheKey];

  const row = getFromDb(flagName, clinicId, callId);
  if (!row) {
    cache[cacheKey] = !!configVal;
    return cache[cacheKey];
  }

  if (row.enabled_for_clinic_ids) {
    try {
      const ids = typeof row.enabled_for_clinic_ids === 'string'
        ? JSON.parse(row.enabled_for_clinic_ids) : row.enabled_for_clinic_ids;
      if (Array.isArray(ids) && clinicId && ids.includes(clinicId)) {
        cache[cacheKey] = true;
        return true;
      }
    } catch (_) {}
  }

  if (row.enabled_globally === 1 || row.enabled_globally === true) {
    const pct = row.rollout_pct ?? 100;
    if (pct >= 100) {
      cache[cacheKey] = true;
      return true;
    }
    if (callId && pct > 0) {
      const hash = callId.split('').reduce((a, c) => ((a << 5) - a) + c.charCodeAt(0), 0);
      const bucket = Math.abs(hash) % 100;
      cache[cacheKey] = bucket < pct;
      return cache[cacheKey];
    }
  }

  cache[cacheKey] = !!configVal;
  return cache[cacheKey];
}

module.exports = {
  isEnabled,
  getConfig: () => configFlags.getAll()
};
