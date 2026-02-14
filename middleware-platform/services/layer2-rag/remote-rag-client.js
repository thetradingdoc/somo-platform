/**
 * Remote RAG Client - Colab RAG API
 *
 * Calls the Colab RAG API (Pinecone-backed) to retrieve medical code candidates.
 * Used by getCandidatesForCoding in knowledge-service for PDF extraction and voice.
 * Returns null on failure to allow local fallback.
 */

const axios = require('axios');

const RAG_API_URL = process.env.RAG_API_URL;
const RAG_TIMEOUT = parseInt(process.env.RAG_TIMEOUT || '10000', 10);

let logger;
try {
  logger = require('../logger');
} catch (_) {
  logger = { info: (...a) => console.log(...a), warn: (...a) => console.warn(...a), error: (...a) => console.error(...a) };
}

/**
 * Call Colab RAG API to retrieve medical codes.
 *
 * @param {Object} params
 * @param {string} params.query - Clinical text or structured findings
 * @param {string} [params.specialty] - Medical specialty (e.g. orthopedics, cardiology)
 * @param {string} [params.region] - Region code (e.g. US)
 * @param {string[]} [params.exclusion_terms] - Terms to exclude from results
 * @param {number} [params.top_k] - Max results per code type
 * @returns {Promise<Object|null>} { icd10, cpt, hcpcs } or null if unavailable
 */
async function retrieveFromColabRAG(params) {
  if (!RAG_API_URL || !RAG_API_URL.trim()) {
    return null;
  }

  const startTime = Date.now();

  try {
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

    const response = await axios.post(
      `${RAG_API_URL.replace(/\/$/, '')}/api/retrieve`,
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

    logger.info('Colab RAG response received', {
      icd10_count: icd10.length,
      cpt_count: cpt.length,
      hcpcs_count: hcpcs.length,
      duration_ms: duration
    });

    return { icd10, cpt, hcpcs };
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.warn('Colab RAG API call failed', {
      error: error.message,
      url: RAG_API_URL,
      duration_ms: duration,
      status: error.response?.status
    });
    return null;
  }
}

/**
 * Health check for Colab RAG API.
 * @returns {Promise<Object>} { healthy: boolean, status?: Object, reason?: string }
 */
async function checkHealth() {
  if (!RAG_API_URL || !RAG_API_URL.trim()) {
    return { healthy: false, reason: 'RAG_API_URL not configured' };
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
  checkHealth
};
