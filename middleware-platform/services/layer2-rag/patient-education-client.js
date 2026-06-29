/**
 * Patient education passage retrieval (parallel to code-oriented Colab /retrieve).
 *
 * Env:
 * - RAG_EDUCATION_URL — base URL for education index (e.g. https://host or http://localhost:4000/api/rag)
 * - If unset, uses RAG_API_URL (same as remote-rag-client) with /retrieve_passages
 */

const crypto = require('crypto');
const axios = require('axios');
const circuitBreaker = require('../../utils/circuit-breaker');
const { buildPatientEducationQuery } = require('./patient-education-query');
const { rerankPassagesWithContentPolicy } = require('./patient-education-passage-rerank');

const RAG_TIMEOUT = parseInt(process.env.RAG_EDUCATION_TIMEOUT || process.env.RAG_TIMEOUT || '12000', 10);
const RAG_RETRIES = parseInt(process.env.RAG_EDUCATION_RETRIES || process.env.RAG_RETRIES || '2', 10);

let logger;
try {
  logger = require('../logger');
} catch (_) {
  logger = { info: (...a) => console.log(...a), warn: (...a) => console.warn(...a), error: (...a) => console.error(...a) };
}

function getEducationBaseUrl() {
  const edu = (process.env.RAG_EDUCATION_URL || '').trim();
  const fallback = (process.env.RAG_API_URL || 'http://localhost:4000/api/rag').trim();
  const u = edu || fallback;
  return u.replace(/\/$/, '');
}

/** One circuit breaker per resolved base URL (avoids sharing state across different endpoints). */
function circuitBreakerNameForBase(base) {
  const h = crypto.createHash('sha256').update(base).digest('hex').slice(0, 16);
  return `remote_rag_education_${h}`;
}

function mergeQueryForSingleBackend(baseQuery, hybrid) {
  if (!hybrid || (!hybrid.dense_query && !(hybrid.bm25_terms || []).length)) {
    return baseQuery;
  }
  const terms = (hybrid.bm25_terms || []).join(' ');
  const dense = hybrid.dense_query && hybrid.dense_query !== baseQuery ? hybrid.dense_query : '';
  return [baseQuery, dense, terms].filter(Boolean).join('\n').slice(0, 8000);
}

function previewQuery(q, max = 60) {
  const t = String(q || '').replace(/\s+/g, ' ').trim();
  return t.length <= max ? t : `${t.slice(0, max)}…`;
}

/**
 * @param {object} params
 * @param {string} params.query
 * @param {string} [params.specialty]
 * @param {string} [params.region]
 * @param {number} [params.top_k]
 * @param {object} [params.filters]
 * @param {object} [params.hybrid]
 * @param {string[]} [params.exclusion_terms]
 * @returns {Promise<{ passages: object[], metadata: object }|null>}
 */
async function retrievePatientEducationPassages(params = {}) {
  const base = getEducationBaseUrl();
  if (!base) {
    logger.warn('[patient-education-client] No RAG_EDUCATION_URL or RAG_API_URL');
    return null;
  }

  const payload = {
    query: (params.query || '').toString().trim(),
    specialty: params.specialty || 'dermatology',
    region: params.region || 'US',
    top_k: params.top_k ?? 12,
    filters: params.filters && typeof params.filters === 'object' ? params.filters : {},
    hybrid: params.hybrid && typeof params.hybrid === 'object' ? params.hybrid : undefined,
    exclusion_terms: Array.isArray(params.exclusion_terms) ? params.exclusion_terms : []
  };

  payload.query = mergeQueryForSingleBackend(payload.query, payload.hybrid);

  if (!payload.query) {
    console.log('[derm-rag] retrieved 0 passages', { reason: 'empty_query' });
    return { passages: [], metadata: { source: 'empty_query' } };
  }

  const breaker = circuitBreaker.getOrCreate(circuitBreakerNameForBase(base), {
    failureThreshold: parseInt(process.env.RAG_EDUCATION_CIRCUIT_FAILURE_THRESHOLD || process.env.RAG_CIRCUIT_FAILURE_THRESHOLD || '5', 10),
    windowMs: parseInt(process.env.RAG_CIRCUIT_WINDOW_MS || '60000', 10),
    resetTimeMs: parseInt(process.env.RAG_CIRCUIT_RESET_MS || '30000', 10)
  });

  async function doCall() {
    let response;
    for (let attempt = 0; attempt <= RAG_RETRIES; attempt++) {
      try {
        response = await axios.post(`${base}/retrieve_passages`, payload, {
          timeout: RAG_TIMEOUT,
          headers: {
            'Content-Type': 'application/json',
            'X-Source': 'middleware-platform',
            'ngrok-skip-browser-warning': 'true'
          }
        });
        break;
      } catch (err) {
        if (attempt < RAG_RETRIES) {
          await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
        } else {
          throw err;
        }
      }
    }

    const passages = Array.isArray(response.data?.passages) ? response.data.passages : [];
    const metadata = response.data?.metadata && typeof response.data.metadata === 'object' ? response.data.metadata : {};
    console.log('[derm-rag] retrieved', passages.length, 'passages', {
      query: previewQuery(payload.query),
      specialty: payload.specialty
    });
    return { passages, metadata };
  }

  try {
    return await breaker.execute(doCall, () => {
      logger.warn('[patient-education-client] Circuit open', { base });
      return null;
    });
  } catch (error) {
    logger.warn('[patient-education-client] retrieve_passages failed', {
      error: error.message,
      base
    });
    return null;
  }
}

/**
 * End-to-end: query construction + retrieval + optional lexical rerank.
 * @param {object} opts
 * @param {string} opts.message
 * @param {object} [opts.retrieval_policy] - From classifyDermPatientQA
 * @param {boolean} [opts.needs_clarification]
 * @param {object} [opts.filters] - pediatric, pregnancy, etc.
 */
async function retrievePatientEducationForDermQA(opts = {}) {
  const policy = opts.retrieval_policy || {};
  const pr = policy.passage_retrieval || 'full';
  const topK = typeof policy.top_k === 'number' ? policy.top_k : 12;

  if (pr === 'none' || topK <= 0) {
    return {
      skipped: true,
      reason: 'retrieval_policy',
      passages: [],
      metadata: {}
    };
  }

  const q = await buildPatientEducationQuery(opts.message || '', {
    needs_clarification: !!opts.needs_clarification
  });

  const filters = {
    ...(opts.filters || {}),
    corpus_version: opts.filters?.corpus_version || 'derm-education-v1'
  };

  const raw = await retrievePatientEducationPassages({
    query: q.query,
    specialty: policy.specialty || 'dermatology',
    top_k: pr === 'minimal' ? Math.min(topK, 5) : topK,
    filters,
    hybrid: q.hybrid,
    exclusion_terms: opts.exclusion_terms
  });

  if (!raw) {
    return { skipped: false, passages: [], metadata: { source: 'unavailable' }, query: q };
  }

  let metadata = raw.metadata && typeof raw.metadata === 'object' ? { ...raw.metadata } : {};
  let passages = raw.passages || [];
  const rerankCap = pr === 'minimal' ? Math.min(topK, 5) : topK;
  if (process.env.DERM_EDU_LEXICAL_RERANK !== '0' && process.env.DERM_EDU_LEXICAL_RERANK !== 'false') {
    const res = rerankPassagesWithContentPolicy(passages, q.query, rerankCap);
    passages = res.passages;
    metadata.content_policy = {
      dropped_spam: res.dropped_spam,
      all_filtered_spam: res.all_filtered_spam
    };
  } else {
    passages = passages.slice(0, rerankCap);
  }

  return {
    skipped: false,
    passages,
    metadata,
    query: q,
    retrieval_policy_applied: policy
  };
}

async function checkEducationHealth() {
  const base = getEducationBaseUrl();
  if (!base) return { healthy: false, reason: 'no base url' };
  try {
    const response = await axios.get(`${base}/health`, {
      timeout: 5000,
      headers: { 'ngrok-skip-browser-warning': 'true' }
    });
    return { healthy: true, status: response.data };
  } catch (e) {
    return { healthy: false, reason: e.message, url: base };
  }
}

module.exports = {
  retrievePatientEducationPassages,
  retrievePatientEducationForDermQA,
  getEducationBaseUrl,
  mergeQueryForSingleBackend,
  checkEducationHealth
};
