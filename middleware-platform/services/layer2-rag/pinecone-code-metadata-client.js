'use strict';

/**
 * Direct Pinecone query fallback when Render RAG returns empty CPT/HCPCS.
 * Aggregates cpt_codes / icd10_codes from chunk metadata.
 */

const db = require('../../database');
const { pineconeQuery, isPineconeConfigured } = require('../platform/pinecone-rest');
const { embedText } = require('../shared/semantic-search-service');

function splitMetadataCodes(value) {
  if (!value) return [];
  const parts = Array.isArray(value)
    ? value
    : String(value).replace(/;/g, ',').split(',');
  const out = [];
  for (const p of parts) {
    const code = String(p).trim().toUpperCase();
    if (code && !out.includes(code)) out.push(code);
  }
  return out;
}

function lookupDescription(code, type) {
  if (!code) return '';
  const raw = String(code).trim();
  try {
    const sqlite = db.db || db;
    if (type === 'icd10') {
      const row = sqlite.prepare(
        `SELECT description FROM icd10_codes WHERE UPPER(REPLACE(TRIM(code), '.', '')) = UPPER(REPLACE(?, '.', '')) LIMIT 1`
      ).get(raw);
      return row?.description || '';
    }
    if (type === 'cpt') {
      const row = sqlite.prepare('SELECT description FROM cpt_codes WHERE UPPER(TRIM(code)) = UPPER(?) LIMIT 1').get(raw);
      return row?.description || '';
    }
    if (type === 'hcpcs') {
      const row = sqlite.prepare('SELECT long_desc FROM hcpcs_codes WHERE UPPER(TRIM(code)) = UPPER(?) LIMIT 1').get(raw);
      return row?.long_desc || '';
    }
  } catch (_) { /* optional */ }
  return '';
}

function enrichCandidates(candidates, type) {
  return (candidates || []).map((c) => ({
    ...c,
    description: c.description || lookupDescription(c.code, type)
  }));
}

function isValidIcd10Code(code) {
  const norm = String(code || '').replace(/\./g, '').trim().toUpperCase();
  if (!norm || norm.length < 3 || norm.length > 7) return false;
  if (/^\d+$/.test(norm)) return false;
  if (norm.startsWith('Y')) return false;
  return /^[A-TV-Z][0-9A-Z]{2,6}$/.test(norm);
}

function isValidCodeForType(code, type) {
  const norm = String(code || '').trim().toUpperCase();
  if (!norm) return false;
  if (type === 'icd10') return isValidIcd10Code(norm);
  if (type === 'cpt') return /^\d{5}$/.test(norm.replace(/\./g, ''));
  if (type === 'hcpcs') return /^[A-Z0-9]{4,5}$/.test(norm);
  return true;
}

function aggregateFromMatches(matches, field, type) {
  const minScore = parseFloat(process.env.PINECONE_MIN_SCORE || '0.45', 10);
  const fallbackMin = parseFloat(process.env.PINECONE_FALLBACK_MIN_SCORE || '0.35', 10);
  let filtered = (matches || []).filter((m) => {
    const score = typeof m.score === 'number' ? m.score : 0;
    return score >= minScore;
  });
  if (!filtered.length) {
    filtered = (matches || [])
      .filter((m) => (typeof m.score === 'number' ? m.score : 0) >= fallbackMin)
      .slice(0, 10);
  }
  const counts = new Map();
  const maxScore = new Map();
  for (const m of filtered) {
    const meta = m.metadata || {};
    const score = typeof m.score === 'number' ? m.score : 0;
    for (const code of splitMetadataCodes(meta[field])) {
      if (!isValidCodeForType(code, type)) continue;
      counts.set(code, (counts.get(code) || 0) + 1);
      maxScore.set(code, Math.max(maxScore.get(code) || 0, score));
    }
  }
  const ranked = [...counts.keys()].sort((a, b) => {
    const dc = (counts.get(b) || 0) - (counts.get(a) || 0);
    if (dc !== 0) return dc;
    return (maxScore.get(b) || 0) - (maxScore.get(a) || 0);
  });
  return enrichCandidates(
    ranked.map((code) => {
      const raw = maxScore.get(code) || 0.5;
      const validated = !!lookupDescription(code, type);
      const confidence = validated && type === 'icd10'
        ? Math.max(raw, 0.68)
        : (validated ? Math.max(raw, 0.65) : raw);
      return {
        code,
        description: '',
        confidence
      };
    }),
    type
  );
}

function pineconeFallbackEnabled() {
  if (process.env.RAG_CPT_FALLBACK_PINECONE === '0') return false;
  return isPineconeConfigured();
}

/**
 * @param {string} query
 * @param {object} opts - { top_k }
 * @returns {Promise<{ icd10: object[], cpt: object[], hcpcs: object[] }|null>}
 */
async function retrieveCodesFromPineconeMetadata(query, opts = {}) {
  if (!pineconeFallbackEnabled() || !query || !String(query).trim()) return null;
  const topK = Math.min(30, Math.max(20, opts.top_k || parseInt(process.env.PINECONE_TOP_K || '20', 10)));
  try {
    const vector = await embedText(String(query).trim().slice(0, 2000));
    if (!vector || !vector.length) return null;
    const matches = await pineconeQuery(vector, {
      topK,
      timeoutMs: parseInt(process.env.REMOTE_RAG_TIMEOUT_MS || '8000', 10)
    });
    if (!matches.length) return null;
    return {
      icd10: aggregateFromMatches(matches, 'icd10_codes', 'icd10'),
      cpt: aggregateFromMatches(matches, 'cpt_codes', 'cpt'),
      hcpcs: aggregateFromMatches(matches, 'hcpcs_codes', 'hcpcs')
    };
  } catch (e) {
    console.warn('[pinecone-code-metadata] retrieval failed:', e.message);
    return null;
  }
}

module.exports = {
  retrieveCodesFromPineconeMetadata,
  aggregateFromMatches,
  splitMetadataCodes,
  pineconeFallbackEnabled,
  lookupDescription,
  isValidIcd10Code,
  isValidCodeForType
};
