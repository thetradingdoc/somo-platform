/**
 * Guideline Conflict Resolver - Layer 2 RAG
 *
 * Checks ICD-10 Excludes1/Excludes2-style rules to filter conflicting codes.
 * CMS compliance: prevents billing codes that violate official guidelines.
 */

const fs = require('fs');
const path = require('path');

const RULES_PATH = path.resolve(__dirname, '../../../Knowledge/rules/icd10-excludes-rules.json');
let rulesCache = null;

function loadRules() {
  if (rulesCache) return rulesCache;
  rulesCache = { excludes1: [], excludes2: [] };
  try {
    if (fs.existsSync(RULES_PATH)) {
      const raw = fs.readFileSync(RULES_PATH, 'utf8');
      const parsed = JSON.parse(raw);
      rulesCache.excludes1 = parsed.excludes1 || [];
      rulesCache.excludes2 = parsed.excludes2 || [];
    }
  } catch (e) {
    console.warn('⚠️  Guideline resolver rules load failed:', e.message);
  }
  return rulesCache;
}

function normalizeCode(code) {
  return String(code || '').trim().toUpperCase().replace(/\./g, '');
}

/**
 * Check if a candidate ICD-10 code conflicts with already-selected codes (Excludes1).
 * @param {string} candidateCode - Code to check
 * @param {string[]} primaryCodes - Already selected codes (e.g. primary diagnosis)
 * @returns {{ conflict: boolean, reason?: string }}
 */
function checkIcd10Conflict(candidateCode, primaryCodes = []) {
  const rules = loadRules();
  const cand = normalizeCode(candidateCode);
  const primaries = (primaryCodes || []).map(normalizeCode).filter(Boolean);

  for (const rule of rules.excludes1) {
    const whenRe = rule.when_code_pattern ? new RegExp(rule.when_code_pattern.replace(/\./g, '\\.?')) : null;
    const exclRe = rule.excludes_pattern ? new RegExp(rule.excludes_pattern.replace(/\./g, '\\.?')) : null;
    if (!whenRe || !exclRe) continue;

    for (const primary of primaries) {
      if (whenRe.test(primary) && exclRe.test(cand)) {
        return { conflict: true, reason: rule.reason || 'Excludes1 conflict' };
      }
      if (exclRe.test(primary) && whenRe.test(cand)) {
        return { conflict: true, reason: rule.reason || 'Excludes1 conflict' };
      }
    }
  }
  return { conflict: false };
}

/**
 * Filter ICD-10 candidates by Excludes1 conflicts with primary codes.
 * @param {Array<{code, ...}>} candidates - Candidate ICD-10 codes
 * @param {string[]} primaryCodes - Already selected primary codes
 * @returns {{ filtered: Array, conflicts: Array<{code, reason}> }}
 */
function filterIcd10ByGuidelines(candidates, primaryCodes = []) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return { filtered: [], conflicts: [] };
  }
  const primaries = (primaryCodes || []).map(c => (typeof c === 'string' ? c : c?.code)).filter(Boolean);
  const filtered = [];
  const conflicts = [];
  for (const c of candidates) {
    const code = c?.code || c;
    const check = checkIcd10Conflict(code, primaries);
    if (check.conflict) {
      conflicts.push({ code, reason: check.reason });
    } else {
      filtered.push(c);
      primaries.push(code);
    }
  }
  return { filtered, conflicts };
}

module.exports = {
  loadRules,
  checkIcd10Conflict,
  filterIcd10ByGuidelines
};
