/**
 * SEMANTIC SEARCH SERVICE (Phase 2.3 - Optional)
 *
 * Provides embedding-based semantic search for medical codes.
 * Requires OPENAI_API_KEY and pre-populated code_embeddings table.
 * Falls back to empty results when embeddings unavailable (keyword search used instead).
 * P1: Uses OpenAIEmbeddings when available for LangSmith tracing.
 */

require('../utils/langsmith-config');
const db = require('../database');

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const EMBEDDING_MODEL = 'text-embedding-3-small';

let OpenAIEmbeddings = null;
try {
  const pkg = require('@langchain/openai');
  OpenAIEmbeddings = pkg.OpenAIEmbeddings;
} catch (_) {}

function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

async function embedText(text) {
  if (!OPENAI_API_KEY || !text) return null;
  const input = String(text).slice(0, 8000);
  try {
    if (OpenAIEmbeddings && process.env.LANGCHAIN_TRACING_V2 !== 'false') {
      const embeddings = new OpenAIEmbeddings({
        model: EMBEDDING_MODEL,
        openAIApiKey: OPENAI_API_KEY
      });
      const vec = await embeddings.embedQuery(input);
      return Array.isArray(vec) ? vec : null;
    }
    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({ model: EMBEDDING_MODEL, input })
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json.data?.[0]?.embedding || null;
  } catch (e) {
    console.warn('⚠️  Embedding API error:', e.message);
    return null;
  }
}

/**
 * Semantic search over code embeddings. Returns [] when embeddings not available.
 * @param {string} query - Search query
 * @param {number} topK - Max results
 * @param {string} codeType - 'icd10' | 'cpt' | 'hcpcs' | null (all)
 * @param {string} specialty - Optional specialty filter (e.g. 'orthopedics') for scope reduction
 * @param {string} region - Region code (US, UK, ZA). Non-US regions exclude CPT/HCPCS (US-specific).
 */
async function searchCodesBySemantics(query, topK = 15, codeType = null, specialty = null, region = 'US') {
  const q = (query || '').toString().trim();
  if (!q) return [];

  const embeddingCount = typeof db.getCodeEmbeddingsCount === 'function' ? db.getCodeEmbeddingsCount() : 0;
  if (embeddingCount === 0) return [];

  const queryEmbedding = await embedText(q);
  if (!queryEmbedding) return [];

  let rows = typeof db.getAllCodeEmbeddings === 'function' ? db.getAllCodeEmbeddings(codeType, specialty) : [];
  if (region && region.toUpperCase() !== 'US') {
    rows = rows.filter(r => (r.code_type || '').toLowerCase() !== 'cpt' && (r.code_type || '').toLowerCase() !== 'hcpcs');
  }
  if (rows.length === 0) return [];

  const scored = rows.map(r => ({
    ...r,
    score: cosineSimilarity(queryEmbedding, r.embedding)
  }));
  return scored
    .filter(r => r.score > 0.3)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map(({ code, code_type, description_text, score }) => ({
      code,
      code_type,
      description: description_text || '',
      semantic_score: Math.round(score * 1000) / 1000
    }));
}

/**
 * Hybrid search: keyword + optional semantic. Merges and re-ranks.
 * @param {string} query
 * @param {Object} options - { limit, codeTypes: ['icd10','cpt','hcpcs'], specialty, region }
 */
async function hybridSearch(query, options = {}) {
  const limit = options.limit || 15;
  let codeTypes = options.codeTypes || ['icd10', 'cpt', 'hcpcs'];
  const specialty = options.specialty || null;
  const region = options.region || 'US';
  if (region && region.toUpperCase() !== 'US') {
    codeTypes = codeTypes.filter(t => t.toLowerCase() !== 'cpt' && t.toLowerCase() !== 'hcpcs');
    if (codeTypes.length === 0) codeTypes = ['icd10'];
  }

  const keywordService = require('./knowledge-service');
  const keywordResults = [];
  if (codeTypes.includes('icd10')) {
    (keywordService.searchIcd10Codes(query, limit) || []).forEach(r =>
      keywordResults.push({ ...r, code_type: 'icd10', source: 'keyword' })
    );
  }
  if (codeTypes.includes('cpt')) {
    (db.searchCptCodes?.(query, limit) || []).forEach(r =>
      keywordResults.push({ ...r, code_type: 'cpt', source: 'keyword' })
    );
  }
  if (codeTypes.includes('hcpcs')) {
    (keywordService.searchHcpcsCodes?.(query, limit) || []).forEach(r =>
      keywordResults.push({ ...r, code_type: 'hcpcs', source: 'keyword' })
    );
  }

  const semanticResults = await searchCodesBySemantics(query, limit * 2, null, specialty, region);
  if (semanticResults.length === 0) {
    return keywordResults.slice(0, limit);
  }

  const byCode = new Map();
  keywordResults.forEach(r => {
    const key = `${r.code_type}:${r.code}`;
    byCode.set(key, { ...r, score: 0.5 });
  });
  semanticResults.forEach(r => {
    const key = `${r.code_type}:${r.code}`;
    const existing = byCode.get(key);
    const semScore = r.semantic_score || 0;
    if (existing) {
      existing.score = Math.min(1, existing.score + semScore * 0.5);
    } else {
      byCode.set(key, {
        code: r.code,
        description: r.description,
        code_type: r.code_type,
        score: semScore * 0.7
      });
    }
  });
  return Array.from(byCode.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

module.exports = {
  embedText,
  searchCodesBySemantics,
  hybridSearch,
  cosineSimilarity
};
