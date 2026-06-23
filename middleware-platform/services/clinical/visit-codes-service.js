'use strict';

/**
 * Shared visit coding module (Session 6).
 * Single entry for Kelly + Retell suggest_codes_from_symptoms paths.
 */

const knowledgeService = require('../shared/knowledge-service');
const { CODING_CONFIDENCE_THRESHOLD } = require('../../config/coding-thresholds');

const DEFAULT_CONFIDENCE_THRESHOLD = CODING_CONFIDENCE_THRESHOLD;

function normalizeCodeEntry(c) {
  if (!c?.code) return null;
  return {
    code: String(c.code).trim(),
    description: c.description || '',
    confidence: typeof c.confidence === 'number' ? c.confidence : 0.5
  };
}

function topCode(list) {
  const first = (list || []).map(normalizeCodeEntry).filter(Boolean)[0];
  return first?.code || null;
}

function sourceBreakdown(dual) {
  const remote = dual?.remote_knowledge?.metadata?.source || 'none';
  const local = dual?.local_knowledge?.metadata?.source || 'local';
  return { remote, local, sources: [remote, local].filter((s) => s && s !== 'none') };
}

/**
 * @param {string} clinicalText
 * @param {object} options - { clinicId, callId, maxIcd10, maxCpt, useSemantic, specialty }
 */
async function getVisitCodes(clinicalText, options = {}) {
  const text = String(clinicalText || '').trim();
  if (!text) {
    return {
      primary_icd10: null,
      primary_cpt: null,
      icd10: [],
      cpt: [],
      hcpcs: [],
      confidence: 0,
      sources: [],
      source_breakdown: { remote: 'none', local: 'none', sources: [] },
      invalid_codes: undefined
    };
  }

  const dual = await knowledgeService.getCodeCandidatesDualSource(text, {
    maxIcd10: options.maxIcd10 ?? 5,
    maxCpt: options.maxCpt ?? 3,
    maxHcpcs: options.maxHcpcs ?? 3,
    clinicId: options.clinicId || null,
    callId: options.callId || null,
    specialty: options.specialty || 'general',
    useSemantic: options.useSemantic !== false,
    remoteTimeoutMs: options.remoteTimeoutMs ?? parseInt(process.env.REMOTE_RAG_TIMEOUT_MS || '8000', 10)
  });

  const icd10 = (dual.icd10 || []).map(normalizeCodeEntry).filter(Boolean);
  const cpt = (dual.cpt || []).map(normalizeCodeEntry).filter(Boolean);
  const hcpcs = (dual.hcpcs || []).map(normalizeCodeEntry).filter(Boolean);
  const primary_icd10 = topCode(icd10);
  const primary_cpt = topCode(cpt);
  const confidence = Math.max(
    icd10[0]?.confidence || 0,
    cpt[0]?.confidence || 0
  );

  return {
    primary_icd10,
    primary_cpt,
    icd10,
    cpt,
    hcpcs,
    confidence,
    sources: sourceBreakdown(dual).sources,
    source_breakdown: sourceBreakdown(dual),
    invalid_codes: dual.invalid_codes,
    remote_knowledge: dual.remote_knowledge,
    local_knowledge: dual.local_knowledge
  };
}

function codesMeetThreshold(result, threshold = DEFAULT_CONFIDENCE_THRESHOLD) {
  if (!result?.primary_icd10) return false;
  return (result.confidence || 0) >= threshold;
}

module.exports = {
  getVisitCodes,
  codesMeetThreshold,
  DEFAULT_CONFIDENCE_THRESHOLD
};
