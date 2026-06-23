'use strict';

/**
 * LLM boundary guard:
 * - Explanations must cite known evidence/rule IDs from reasoning_map.
 * - This keeps the LLM in "explainer" mode, not "decision-maker" mode.
 */
function buildExplanationGuardContext(reasoningMap) {
  const rm = reasoningMap && typeof reasoningMap === 'object' ? reasoningMap : {};
  return {
    allowed_evidence_ids: Array.isArray(rm.evidence_items) ? rm.evidence_items.map((x) => x.evidence_id).filter(Boolean) : [],
    allowed_rule_ids: Array.isArray(rm.rules_fired) ? rm.rules_fired.map((x) => x.rule_id).filter(Boolean) : [],
    summary: rm?.explanation_payload?.summary || ''
  };
}

function validateExplanationCitations({ text, citations, reasoningMap }) {
  const guard = buildExplanationGuardContext(reasoningMap);
  const refs = Array.isArray(citations) ? citations.map((x) => String(x || '').trim()).filter(Boolean) : [];
  const allowed = new Set([...guard.allowed_evidence_ids, ...guard.allowed_rule_ids]);
  const unsupported = refs.filter((r) => !allowed.has(r));
  const hasAny = refs.length > 0;
  const ok = hasAny && unsupported.length === 0;
  return {
    ok,
    unsupported,
    required: hasAny ? [] : ['at_least_one_citation_required'],
    guard
  };
}

module.exports = {
  buildExplanationGuardContext,
  validateExplanationCitations
};

