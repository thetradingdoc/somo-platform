'use strict';

/**
 * Rank and select primary ICD-10 / CPT / HCPCS from triage candidates.
 * Replaces naive cptCodes[0] / differentials[0] selection.
 */

const knowledgeService = require('./knowledge-service');
const { CODING_CONFIDENCE_THRESHOLD } = require('../config/coding-thresholds');

function scoreCandidate(candidate, { telehealthIntent = false, preferEm = false } = {}) {
  let score = Number(candidate.confidence ?? candidate.score ?? 0.5);
  const code = String(candidate.code || '').trim();
  const desc = String(candidate.description || '').toLowerCase();

  if (telehealthIntent && /^99[0-9]{3}$/.test(code)) score += 0.15;
  if (preferEm && /office|outpatient|established|new patient/.test(desc)) score += 0.1;
  if (/^G[0-9]{4}$/.test(code) && telehealthIntent) score += 0.05;
  return score;
}

function selectPrimaryIcd10(icdCandidates = [], differentials = []) {
  const fromDiff = (differentials || [])
    .filter((d) => d?.icd10)
    .map((d) => ({
      code: d.icd10,
      description: d.condition || '',
      confidence: typeof d.probability === 'number' ? d.probability : 0.85
    }));

  const merged = [...fromDiff];
  for (const c of icdCandidates || []) {
    const code = String(c.code || '').trim();
    if (!code || merged.some((m) => m.code === code)) continue;
    merged.push(c);
  }

  if (!merged.length) return null;

  merged.sort((a, b) => scoreCandidate(b) - scoreCandidate(a));
  return merged[0]?.code?.trim() || null;
}

function selectPrimaryProcedure({
  cptCandidates = [],
  hcpcsCandidates = [],
  primaryIcd10 = null,
  telehealthIntent = false,
  preferEm = true
} = {}) {
  const scored = [];

  for (const c of cptCandidates || []) {
    const code = String(c.code || '').trim();
    if (!code) continue;
    let pairValid = true;
    if (primaryIcd10) {
      const check = knowledgeService.validateCodePair(primaryIcd10, code);
      pairValid = check.valid;
    }
    scored.push({
      code,
      description: c.description,
      code_type: 'cpt',
      score: scoreCandidate(c, { telehealthIntent, preferEm }) + (pairValid ? 0.2 : -1),
      pair_valid: pairValid
    });
  }

  for (const c of hcpcsCandidates || []) {
    const code = String(c.code || '').trim();
    if (!code) continue;
    scored.push({
      code,
      description: c.description || c.long_desc,
      code_type: 'hcpcs',
      score: scoreCandidate(c, { telehealthIntent, preferEm: false }),
      pair_valid: true
    });
  }

  if (!scored.length) return { code: null, code_type: null, pair_valid: false };

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (best.score < CODING_CONFIDENCE_THRESHOLD && best.code_type === 'hcpcs' && !cptCandidates?.length) {
    return { code: best.code, code_type: 'hcpcs', pair_valid: true, confidence: best.score };
  }
  if (!best.pair_valid) return { code: null, code_type: null, pair_valid: false, reason: 'invalid_pair' };

  try {
    const { getHistoricalConfidence } = require('./code-acceptance-service');
    const hist = getHistoricalConfidence(best.code, { payerId: null });
    if (hist?.confidence != null) {
      best.score = (best.score + hist.confidence) / 2;
    }
  } catch (_) {}

  return {
    code: best.code,
    code_type: best.code_type,
    pair_valid: true,
    confidence: best.score
  };
}

module.exports = {
  selectPrimaryIcd10,
  selectPrimaryProcedure,
  scoreCandidate
};
