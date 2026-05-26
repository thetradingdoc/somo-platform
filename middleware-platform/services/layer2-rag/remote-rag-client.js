/**
 * Remote RAG Client — Pinecone metadata (primary) + optional Colab Flask API (legacy).
 *
 * Used by getCodeCandidatesDualSource in knowledge-service.
 * Returns empty arrays on failure so local SQLite search still runs.
 */

const axios = require('axios');
const circuitBreaker = require('../../utils/circuit-breaker');
const {
  retrieveCodesFromPineconeMetadata,
  pineconeFallbackEnabled
} = require('./pinecone-code-metadata-client');

const RAG_TIMEOUT = parseInt(process.env.RAG_TIMEOUT || '10000', 10);
const RAG_RETRIES = parseInt(process.env.RAG_RETRIES || '2', 10);
const DEFAULT_REMOTE_TIMEOUT_MS = parseInt(process.env.REMOTE_RAG_TIMEOUT_MS || '2000', 10);

/** Empty/disabled RAG_API_URL skips Colab; unset no longer defaults to localhost (use Pinecone). */
function resolveRagApiUrl() {
  const raw = process.env.RAG_API_URL;
  if (raw === undefined || raw === null) {
    return null;
  }
  const u = String(raw).trim();
  if (!u || u === '0' || u === 'false' || u === 'disabled') return null;
  return u;
}

let logger;
try {
  logger = require('../logger');
} catch (_) {
  logger = { info: (...a) => console.log(...a), warn: (...a) => console.warn(...a), error: (...a) => console.error(...a) };
}

function emptyRemote(source = 'none') {
  return { icd10: [], cpt: [], hcpcs: [], metadata: { source, rag_cpt_source: 'empty' } };
}

function withTimeout(promise, timeoutMs, label = 'remote') {
  const ms = timeoutMs > 0 ? timeoutMs : DEFAULT_REMOTE_TIMEOUT_MS;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`${label}_timeout`)), ms);
    })
  ]);
}

/**
 * Primary remote retrieval: live Pinecone metadata, optional Colab fill gaps.
 * @param {Object} params - { query, specialty, region, exclusion_terms, top_k }
 * @param {Object} options - { timeoutMs }
 */
async function retrieveRemoteCodeKnowledge(params, options = {}) {
  const payload = {
    query: (params.query || '').toString().trim(),
    specialty: params.specialty || 'general',
    region: params.region || 'US',
    exclusion_terms: Array.isArray(params.exclusion_terms) ? params.exclusion_terms : [],
    top_k: params.top_k || 20
  };

  if (!payload.query) {
    return emptyRemote('empty_query');
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_REMOTE_TIMEOUT_MS;
  let out = emptyRemote('none');

  if (pineconeFallbackEnabled()) {
    try {
      const pinecone = await withTimeout(
        retrieveCodesFromPineconeMetadata(payload.query, { top_k: payload.top_k }),
        timeoutMs,
        'pinecone'
      );
      if (pinecone && (pinecone.icd10?.length || pinecone.cpt?.length || pinecone.hcpcs?.length)) {
        out = {
          icd10: pinecone.icd10 || [],
          cpt: pinecone.cpt || [],
          hcpcs: pinecone.hcpcs || [],
          metadata: { source: 'pinecone', rag_cpt_source: 'pinecone' }
        };
        logger.info('Pinecone remote code retrieval', {
          icd10_count: out.icd10.length,
          cpt_count: out.cpt.length,
          hcpcs_count: out.hcpcs.length
        });
      }
    } catch (e) {
      logger.warn('Pinecone remote retrieval failed', { error: e.message });
    }
  }

  const ragUrl = resolveRagApiUrl();
  if (ragUrl) {
    const needFlask =
      out.icd10.length === 0 || out.cpt.length === 0 || out.hcpcs.length === 0;
    if (needFlask) {
      try {
        const flask = await withTimeout(
          retrieveFromColabRAGInternal(params, ragUrl),
          timeoutMs,
          'colab_rag'
        );
        if (flask) {
          if (out.icd10.length === 0 && flask.icd10?.length) out.icd10 = flask.icd10;
          if (out.cpt.length === 0 && flask.cpt?.length) {
            out.cpt = flask.cpt;
            out.metadata.rag_cpt_source = flask.metadata?.rag_cpt_source || 'flask';
          }
          if (out.hcpcs.length === 0 && flask.hcpcs?.length) out.hcpcs = flask.hcpcs;
          out.metadata.source = out.metadata.source === 'pinecone' ? 'pinecone+flask' : 'flask';
        }
      } catch (e) {
        logger.warn('Colab RAG remote retrieval failed', { error: e.message, url: ragUrl });
      }
    }
  }

  return out;
}

/**
 * Legacy Colab Flask RAG API (optional when RAG_API_URL is set).
 */
async function retrieveFromColabRAG(params) {
  const RAG_API_URL = resolveRagApiUrl();
  if (!RAG_API_URL) {
    return null;
  }
  return retrieveFromColabRAGInternal(params, RAG_API_URL);
}

async function retrieveFromColabRAGInternal(params, RAG_API_URL) {
  const startTime = Date.now();
  const breaker = circuitBreaker.getOrCreate('remote_rag', {
    failureThreshold: parseInt(process.env.RAG_CIRCUIT_FAILURE_THRESHOLD || '5', 10),
    windowMs: parseInt(process.env.RAG_CIRCUIT_WINDOW_MS || '60000', 10),
    resetTimeMs: parseInt(process.env.RAG_CIRCUIT_RESET_MS || '30000', 10)
  });

  async function doCall() {
    const payload = {
      query: (params.query || '').toString().trim(),
      specialty: params.specialty || 'general',
      region: params.region || 'US',
      exclusion_terms: Array.isArray(params.exclusion_terms) ? params.exclusion_terms : [],
      top_k: params.top_k || 20
    };

    if (!payload.query) {
      return null;
    }

    logger.info('Calling Colab RAG API', {
      url: RAG_API_URL,
      query_length: payload.query.length,
      specialty: payload.specialty
    });

    let response;
    for (let attempt = 0; attempt <= RAG_RETRIES; attempt++) {
      try {
        response = await axios.post(
          `${RAG_API_URL.replace(/\/$/, '')}/retrieve`,
          payload,
          {
            timeout: RAG_TIMEOUT,
            headers: {
              'Content-Type': 'application/json',
              'X-Source': 'middleware-platform',
              'ngrok-skip-browser-warning': 'true'
            }
          }
        );
        break;
      } catch (err) {
        if (attempt < RAG_RETRIES) {
          await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
        } else {
          throw err;
        }
      }
    }

    const duration = Date.now() - startTime;

    const icd10 = (response.data.icd10 || []).map((c) => ({
      code: c.code,
      description: c.description || '',
      confidence: typeof c.score === 'number' ? c.score : (c.confidence ?? 0.8)
    }));

    const cpt = (response.data.cpt || []).map((c) => ({
      code: c.code,
      description: c.description || '',
      confidence: typeof c.score === 'number' ? c.score : (c.confidence ?? 0.8)
    }));

    const hcpcs = (response.data.hcpcs || []).map((c) => ({
      code: c.code,
      description: c.description || '',
      confidence: typeof c.score === 'number' ? c.score : (c.confidence ?? 0.8)
    }));

    let outIcd10 = icd10;
    let outCpt = cpt;
    let outHcpcs = hcpcs;
    let ragCptSource = outCpt.length > 0 ? 'flask' : 'empty';

    const needFallback =
      pineconeFallbackEnabled() &&
      (outCpt.length === 0 || outHcpcs.length === 0 || outIcd10.length === 0);

    if (needFallback) {
      const pineconeFallback = await retrieveCodesFromPineconeMetadata(payload.query, {
        top_k: payload.top_k
      });
      if (pineconeFallback) {
        if (outCpt.length === 0 && pineconeFallback.cpt?.length) {
          outCpt = pineconeFallback.cpt;
          ragCptSource = 'pinecone_fallback';
        }
        if (outHcpcs.length === 0 && pineconeFallback.hcpcs?.length) {
          outHcpcs = pineconeFallback.hcpcs;
        }
        if (outIcd10.length === 0 && pineconeFallback.icd10?.length) {
          outIcd10 = pineconeFallback.icd10;
        }
      }
    }

    logger.info('Colab RAG response received', {
      icd10_count: outIcd10.length,
      cpt_count: outCpt.length,
      hcpcs_count: outHcpcs.length,
      rag_cpt_source: ragCptSource,
      duration_ms: duration
    });

    return {
      icd10: outIcd10,
      cpt: outCpt,
      hcpcs: outHcpcs,
      metadata: { rag_cpt_source: ragCptSource, source: 'flask' }
    };
  }

  try {
    return await breaker.execute(doCall, () => {
      logger.warn('Colab RAG circuit open (using local knowledge only)', { url: RAG_API_URL });
      return null;
    });
  } catch (error) {
    logger.warn('Colab RAG API call failed', {
      error: error.message,
      url: RAG_API_URL,
      duration_ms: Date.now() - startTime
    });
    return null;
  }
}

async function checkHealth() {
  const RAG_API_URL = resolveRagApiUrl();
  if (!RAG_API_URL) {
    return {
      healthy: pineconeFallbackEnabled(),
      reason: pineconeFallbackEnabled() ? 'Pinecone only (RAG_API_URL disabled)' : 'No remote RAG configured'
    };
  }

  try {
    const response = await axios.get(`${RAG_API_URL.replace(/\/$/, '')}/health`, {
      timeout: 5000,
      headers: { 'ngrok-skip-browser-warning': 'true' }
    });
    return { healthy: true, status: response.data };
  } catch (error) {
    return { healthy: false, reason: error.message, url: RAG_API_URL };
  }
}

module.exports = {
  retrieveFromColabRAG,
  retrieveRemoteCodeKnowledge,
  checkHealth,
  resolveRagApiUrl
};
