'use strict';

/**
 * A3 — Explicit impact weights by routine role (treatment/serum > moisturizer > cleanser).
 * Used for conflict ordering (A4) and step metadata merge in the graph.
 */

const ROLE_IMPACT = {
  unknown: 1,
  cleanser: 1,
  toner: 1,
  oil: 2,
  mask: 2,
  moisturizer: 2,
  sunscreen: 3,
  serum: 4,
  treatment: 5,
  other: 1,
};

/** Alias for prompts / metrics — same numeric scale as ROLE_IMPACT */
const ROLE_PRIORITY_WEIGHT = ROLE_IMPACT;

const SEVERITY_RANK = { critical: 3, high: 2, moderate: 1 };

function _normInci(id) {
  return String(id || '')
    .replace(/^cosing:/i, '')
    .trim()
    .toLowerCase();
}

/** Max impact weight among steps that contain this bare INCI id. */
function buildIngredientRoleImpactMap(normalizedSlots) {
  const map = new Map();
  for (const slot of normalizedSlots || []) {
    for (const step of slot.steps || []) {
      const w = ROLE_IMPACT[String(step.role || 'unknown').toLowerCase()] || ROLE_IMPACT.other;
      for (const raw of step.ingredient_ids || []) {
        const id = _normInci(raw);
        if (!id) continue;
        const prev = map.get(id) || 0;
        if (w > prev) map.set(id, w);
      }
    }
  }
  return map;
}

function _conflictRoleScore(hit, impactMap) {
  const a = _normInci(hit.ingredient_a);
  const b = _normInci(hit.ingredient_b);
  const wa = impactMap.get(a) || ROLE_IMPACT.unknown;
  const wb = impactMap.get(b) || ROLE_IMPACT.unknown;
  return wa + wb;
}

/** A4 — prefer conflicts touching higher-minimum roles (serum/treatment) over cleanser-only pairs when sums tie. */
function _conflictMinRoleScore(hit, impactMap) {
  const a = _normInci(hit.ingredient_a);
  const b = _normInci(hit.ingredient_b);
  const wa = impactMap.get(a) || ROLE_IMPACT.unknown;
  const wb = impactMap.get(b) || ROLE_IMPACT.unknown;
  return Math.min(wa, wb);
}

/** A6 — outdoor leave-on / UV-active context ranks above indoor-only at same severity+role */
function _exposureContextRank(hit) {
  const tags = hit.context_tags || [];
  if (tags.includes('context:outdoor_uv_actives')) return 2;
  if (tags.includes('context:outdoor_leave_on')) return 1;
  return 0;
}

/**
 * Stable sort: severity first (critical → moderate), then role impact sum (treatment-heavy pairs first),
 * then minimum role weight, then outdoor context (A6), then deterministic key.
 */
function sortConflictsBySeverityThenRole(conflicts, normalizedSlots) {
  const list = Array.isArray(conflicts) ? [...conflicts] : [];
  const impactMap = buildIngredientRoleImpactMap(normalizedSlots);
  list.sort((x, y) => {
    const sd = (SEVERITY_RANK[y.severity] || 0) - (SEVERITY_RANK[x.severity] || 0);
    if (sd !== 0) return sd;
    const sumDiff = _conflictRoleScore(y, impactMap) - _conflictRoleScore(x, impactMap);
    if (sumDiff !== 0) return sumDiff;
    const minDiff = _conflictMinRoleScore(y, impactMap) - _conflictMinRoleScore(x, impactMap);
    if (minDiff !== 0) return minDiff;
    const ex = _exposureContextRank(y) - _exposureContextRank(x);
    if (ex !== 0) return ex;
    const ka = `${_normInci(x.ingredient_a)}|${_normInci(x.ingredient_b)}`;
    const kb = `${_normInci(y.ingredient_a)}|${_normInci(y.ingredient_b)}`;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
  return list.map((h) => ({
    ...h,
    role_pair_impact: _conflictRoleScore(h, impactMap),
    context_tags: Array.isArray(h.context_tags) ? h.context_tags : [],
  }));
}

module.exports = {
  ROLE_IMPACT,
  ROLE_PRIORITY_WEIGHT,
  buildIngredientRoleImpactMap,
  sortConflictsBySeverityThenRole,
};
