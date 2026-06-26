'use strict';

/**
 * Health education RAG — session-scoped cache + cost guard (max 1 per turn handled upstream).
 */
const { retrievePatientEducationPassages } = require('./layer2-rag/patient-education-client');

const cache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;

function cacheKey(sessionId, query) {
  const q = String(query || '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 200);
  return `${sessionId || 'anon'}:${q}`;
}

function getCached(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

function setCache(key, value) {
  cache.set(key, { at: Date.now(), value });
}

async function retrieveForHealth({ query, sessionId, opqrstMeta = {}, imageCaption = '' } = {}) {
  const enriched = [
    query,
    opqrstMeta?.opqrst?.R || opqrstMeta?.opqrst?.region || '',
    imageCaption
  ].filter(Boolean).join('\n');

  const key = cacheKey(sessionId, enriched);
  const hit = getCached(key);
  if (hit) return { ...hit, cached: true };

  const result = await retrievePatientEducationPassages({
    query: enriched,
    specialty: 'dermatology',
    corpus_version: 'derm-education-v1',
    top_k: parseInt(process.env.DERM_EDU_TOP_K || '6', 10)
  });

  setCache(key, result);
  return { ...result, cached: false };
}

function clearSessionCache(sessionId) {
  if (!sessionId) return;
  const prefix = `${sessionId}:`;
  for (const k of cache.keys()) {
    if (k.startsWith(prefix)) cache.delete(k);
  }
}

module.exports = {
  retrieveForHealth,
  clearSessionCache
};
