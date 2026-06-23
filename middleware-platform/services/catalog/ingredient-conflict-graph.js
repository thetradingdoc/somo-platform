'use strict';

const {
  sortConflictsBySeverityThenRole,
  ROLE_IMPACT,
} = require('./routine-conflict-priority');

/**
 * services/ingredient-conflict-graph.js
 *
 * Layer B of the reasoning pipeline: deterministic biochemistry.
 *
 * Operates exclusively on RESOLVED canonical ingredient IDs (ingredient_canonical_id
 * from product_ingredients). Never does free-text chemistry — that's the LLM's job.
 *
 * Public API
 * ──────────
 *   buildBasket(ingredientIds)  → BasketResult
 *   checkPair(a, b)             → EdgeResult | null
 *   evaluateRoutine(slots)      → RoutineVerdict  ← main entry point for Kelly
 *
 * RoutineVerdict is the JSON structure the Composer (Layer C / LLM) must cite
 * verbatim in its reply.  The LLM may explain; it may NOT soften a verdict of
 * 'avoid' or 'critical'.
 */

/**
 * @typedef {Object} Edge
 * @property {string} ingredient_a
 * @property {string} ingredient_b
 * @property {string} interaction_type
 * @property {'critical'|'high'|'moderate'} severity
 * @property {number|null} spacing_hours
 * @property {string} notes
 * @property {'established'|'probable'|'contested'} evidence_level
 */

/**
 * @typedef {Object} ConflictHit
 * @property {string} ingredient_a     - canonical id (cosing:<inci>)
 * @property {string} ingredient_b
 * @property {string} interaction_type
 * @property {'critical'|'high'|'moderate'} severity
 * @property {number|null} spacing_hours
 * @property {string} notes
 * @property {'established'|'probable'|'contested'} evidence_level
 * @property {'avoid'|'caution'|'info'} verdict  - derived from severity
 * @property {string[]} reason_codes             - machine-readable tags for RAG retrieval
 */

/**
 * @typedef {Object} RoutineVerdict
 * @property {'safe'|'caution'|'avoid'} overall
 * @property {ConflictHit[]} conflicts
 * @property {string[]} reason_codes   - union of all reason_codes for retrieval
 * @property {string[]} safe_ids       - ingredient ids with no conflicts
 * @property {{ am: string[], pm: string[] } | null} suggested_split - when spacing needed
 */

// ─── Severity → verdict mapping ───────────────────────────────────────────────
const SEVERITY_VERDICT = {
  critical: 'avoid',
  high: 'caution',
  moderate: 'info',
};

// ─── Severity rank for sorting / overall aggregation ─────────────────────────
const SEVERITY_RANK = { critical: 3, high: 2, moderate: 1 };

/**
 * Derive machine-readable reason_codes from an edge.
 * These are the retrieval keys RAG uses to pull relevant monograph chunks.
 */
function deriveReasonCodes(edge) {
  const codes = [`${edge.interaction_type}`, `severity:${edge.severity}`];
  if (edge.evidence_level === 'contested') codes.push('evidence:contested');

  // Ingredient-class codes so RAG can fetch class-level explanations
  const classMap = {
    retinol: 'class:retinoid',
    tretinoin: 'class:retinoid',
    'retinyl palmitate': 'class:retinoid',
    'glycolic acid': 'class:aha',
    'lactic acid': 'class:aha',
    'mandelic acid': 'class:aha',
    'salicylic acid': 'class:bha',
    'benzoyl peroxide': 'class:antimicrobial_oxidant',
    'ascorbic acid': 'class:antioxidant',
    niacinamide: 'class:vitamin_b3',
    'copper tripeptide-1': 'class:copper_peptide',
  };

  const normA = _stripPrefix(edge.ingredient_a);
  const normB = _stripPrefix(edge.ingredient_b);
  if (classMap[normA]) codes.push(classMap[normA]);
  if (classMap[normB]) codes.push(classMap[normB]);

  return [...new Set(codes)];
}

function _stripPrefix(id) {
  return String(id || '').replace(/^cosing:/, '').trim().toLowerCase();
}

function _norm(id) {
  // Accept both "cosing:niacinamide" and bare "niacinamide"
  return _stripPrefix(id);
}

// ─── Main service factory ─────────────────────────────────────────────────────

/**
 * @param {object} db - better-sqlite3 instance (or compatible)
 * @returns {object} conflict graph service
 */
function createConflictGraph(db) {
  // Prepared statements — created once
  const stmtPair = db.prepare(`
    SELECT * FROM ingredient_interactions
    WHERE ingredient_a = ? AND ingredient_b = ?
    ORDER BY CASE severity WHEN 'critical' THEN 3 WHEN 'high' THEN 2 WHEN 'moderate' THEN 1 ELSE 0 END DESC
    LIMIT 1
  `);

  const stmtAll = db.prepare(`
    SELECT * FROM ingredient_interactions
    WHERE ingredient_a = ?
    ORDER BY CASE severity WHEN 'critical' THEN 3 WHEN 'high' THEN 2 WHEN 'moderate' THEN 1 ELSE 0 END DESC
  `);

  const stmtSeverity = db.prepare(`
    SELECT * FROM ingredient_interactions
    WHERE ingredient_a = ? AND severity = ?
    ORDER BY ingredient_b
  `);

  /**
   * Check one pair — used internally and can be called directly for single-pair UI.
   * @param {string} a - canonical ingredient id
   * @param {string} b - canonical ingredient id
   * @returns {ConflictHit|null}
   */
  function checkPair(a, b) {
    const na = _norm(a);
    const nb = _norm(b);
    if (na === nb) return null; // same ingredient, no self-conflict

    const edge = stmtPair.get(na, nb) || stmtPair.get(nb, na);
    if (!edge) return null;

    return _edgeToHit(edge);
  }

  /**
   * @param {Edge} edge
   * @returns {ConflictHit}
   */
  function _edgeToHit(edge) {
    return {
      ingredient_a: edge.ingredient_a,
      ingredient_b: edge.ingredient_b,
      interaction_type: edge.interaction_type,
      severity: edge.severity,
      spacing_hours: edge.spacing_hours ?? null,
      notes: edge.notes,
      evidence_level: edge.evidence_level,
      verdict: SEVERITY_VERDICT[edge.severity] || 'info',
      reason_codes: deriveReasonCodes(edge),
    };
  }

  /**
   * Evaluate a full basket of ingredient IDs (e.g. all products in a session).
   * Returns every conflict hit for all pairs, ranked by severity.
   *
   * @param {string[]} ingredientIds - canonical ids
   * @returns {{ conflicts: ConflictHit[], safe_ids: string[] }}
   */
  function buildBasket(ingredientIds) {
    const ids = [...new Set(ingredientIds.map(_norm).filter(Boolean))];
    const conflicts = [];
    const conflictedSet = new Set();

    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const hit = checkPair(ids[i], ids[j]);
        if (hit) {
          conflicts.push(hit);
          conflictedSet.add(ids[i]);
          conflictedSet.add(ids[j]);
        }
      }
    }

    // Sort: critical → high → moderate
    conflicts.sort((a, b) => (SEVERITY_RANK[b.severity] || 0) - (SEVERITY_RANK[a.severity] || 0));

    const safe_ids = ids.filter((id) => !conflictedSet.has(id)).map((id) => `cosing:${id}`);

    return { conflicts, safe_ids };
  }

  /**
   * Normalize Kelly / session slots: supports legacy { time, ingredient_ids },
   * or rich { time, step_order, steps[] } from session-state.toRoutineSlots().
   */
  function _normalizeRoutineSlots(slots) {
    const list = Array.isArray(slots) ? slots : [];
    return list.map((slot, i) => {
      const time = slot.time === 'am' || slot.time === 'pm' ? slot.time : 'pm';
      const step_order = Number.isFinite(slot.step_order) ? slot.step_order : i * 10;
      if (Array.isArray(slot.steps) && slot.steps.length > 0) {
        return {
          time,
          step_order,
          steps: slot.steps.map((st, j) => ({
            order: Number.isFinite(st.order) ? st.order : j,
            ingredient_ids: Array.isArray(st.ingredient_ids) ? st.ingredient_ids : [],
            wash_off: st.wash_off === true,
            leave_on: st.leave_on !== false && st.wash_off !== true,
            exposure:
              st.exposure === 'outdoor' || st.exposure === 'indoor' ? st.exposure : 'unknown',
            role: String(st.role || 'unknown').toLowerCase(),
          })),
        };
      }
      const ids = Array.isArray(slot.ingredient_ids) ? slot.ingredient_ids : [];
      return {
        time,
        step_order,
        steps: [
          {
            order: 0,
            ingredient_ids: ids,
            wash_off: false,
            leave_on: true,
            exposure: 'unknown',
            role: 'unknown',
          },
        ],
      };
    });
  }

  /**
   * Pairwise conflicts among ingredients that are on-skin together within one
   * time bucket (am/pm), respecting step order and wash_off (rinse clears actives).
   */
  function _mergeStepMeta(a, b) {
    const expRank = (e) => (e === 'outdoor' ? 2 : e === 'indoor' ? 1 : 0);
    const exp =
      expRank(a.exposure) >= expRank(b.exposure) ? a.exposure : b.exposure;
    const wa = ROLE_IMPACT[String(a.role || 'unknown').toLowerCase()] || 1;
    const wb = ROLE_IMPACT[String(b.role || 'unknown').toLowerCase()] || 1;
    const role = wa >= wb ? a.role : b.role;
    return { exposure: exp, role };
  }

  /** A6 — UV-relevant classes when leave-on steps are marked outdoor */
  function _outdoorContextTagsForHit(hit, outdoorInvolved) {
    if (!outdoorInvolved) return [];
    const rc = hit.reason_codes || [];
    const photoish = rc.some(
      (x) =>
        x === 'class:retinoid' ||
        x === 'class:aha' ||
        x === 'class:bha' ||
        x === 'class:antioxidant'
    );
    if (photoish) return ['context:outdoor_uv_actives'];
    return ['context:outdoor_leave_on'];
  }

  function buildBasketFromTimedSteps(normalizedSlots) {
    const byTime = { am: [], pm: [] };
    for (const s of normalizedSlots) {
      if (byTime[s.time]) byTime[s.time].push(s);
    }
    const conflicts = [];
    const conflictedSet = new Set();
    const allRoutineIds = [];

    for (const slot of normalizedSlots) {
      for (const step of slot.steps) {
        const stepIds = [...new Set((step.ingredient_ids || []).map(_norm).filter(Boolean))];
        for (const id of stepIds) allRoutineIds.push(id);
      }
    }

    for (const time of ['am', 'pm']) {
      const group = byTime[time].sort((a, b) => a.step_order - b.step_order);
      /** @type {Map<string, { exposure: string, role: string }>} */
      let active = new Map();

      for (const slot of group) {
        const orderedSteps = [...slot.steps].sort((a, b) => a.order - b.order);
        for (const step of orderedSteps) {
          const stepIds = [...new Set((step.ingredient_ids || []).map(_norm).filter(Boolean))];
          const stepExposure =
            step.exposure === 'outdoor' || step.exposure === 'indoor'
              ? step.exposure
              : 'unknown';
          const stepRole = String(step.role || 'unknown').toLowerCase();
          if (step.wash_off) {
            active = new Map();
            continue;
          }
          if (!step.leave_on) {
            continue;
          }
          for (const id of stepIds) {
            for (const [prevId, meta] of active) {
              const hit = checkPair(prevId, id);
              if (hit) {
                const outdoorInvolved =
                  meta.exposure === 'outdoor' || stepExposure === 'outdoor';
                const context_tags = _outdoorContextTagsForHit(hit, outdoorInvolved);
                conflicts.push({ ...hit, context_tags });
                conflictedSet.add(_norm(hit.ingredient_a));
                conflictedSet.add(_norm(hit.ingredient_b));
              }
            }
            const prevMeta = active.get(id);
            const nextMeta = { exposure: stepExposure, role: stepRole };
            active.set(
              id,
              prevMeta ? _mergeStepMeta(prevMeta, nextMeta) : nextMeta
            );
          }
        }
      }
    }

    const dedup = _dedupeConflicts(conflicts);
    const uniqIds = [...new Set(allRoutineIds.filter(Boolean))];
    const safe_ids = uniqIds.filter((id) => !conflictedSet.has(id)).map((id) => `cosing:${id}`);

    return { conflicts: dedup, safe_ids };
  }

  function _conflictKey(c) {
    const a = _norm(c.ingredient_a);
    const b = _norm(c.ingredient_b);
    return a < b ? `${a}|${b}|${c.interaction_type}` : `${b}|${a}|${c.interaction_type}`;
  }

  function _dedupeConflicts(conflicts) {
    const seen = new Map();
    for (const c of conflicts) {
      const k = _conflictKey(c);
      const existing = seen.get(k);
      if (!existing) {
        seen.set(k, { ...c, context_tags: [...(c.context_tags || [])] });
      } else {
        const merged = new Set([
          ...(existing.context_tags || []),
          ...(c.context_tags || []),
        ]);
        seen.set(k, { ...existing, context_tags: [...merged] });
      }
    }
    const out = [...seen.values()];
    out.sort((a, b) => (SEVERITY_RANK[b.severity] || 0) - (SEVERITY_RANK[a.severity] || 0));
    return out;
  }

  /**
   * Main entry for Kelly / RoutineReasoning tool.
   *
   * @param {RoutineSlot[]} slots  - legacy { time, ingredient_ids } or rich steps from toRoutineSlots()
   * @returns {RoutineVerdict}
   */
  function evaluateRoutine(slots) {
    const normalized = _normalizeRoutineSlots(slots);
    const { conflicts: conflictsRaw, safe_ids } = buildBasketFromTimedSteps(normalized);
    const conflicts = sortConflictsBySeverityThenRole(conflictsRaw, normalized);

    // Overall verdict — highest severity wins
    let overall = 'safe';
    for (const c of conflicts) {
      if (c.severity === 'critical') { overall = 'avoid'; break; }
      if (c.severity === 'high') overall = 'caution';
      if (c.severity === 'moderate' && overall === 'safe') overall = 'caution';
    }

    // Reason codes — union across all hits
    const allCodes = [...new Set(conflicts.flatMap((c) => c.reason_codes))];

    // Suggested AM/PM split — only emit when there are high/critical conflicts
    // that have spacing_hours (not null = separable, not same-night-blocked)
    const separableConflicts = conflicts.filter(
      (c) => c.severity !== 'critical' && c.spacing_hours !== null && c.spacing_hours >= 8
    );
    let suggested_split = null;
    if (separableConflicts.length > 0) {
      const allIds = [
        ...new Set(
          normalized.flatMap((s) =>
            s.steps.flatMap((st) => (st.ingredient_ids || []).map(_norm).filter(Boolean))
          )
        ),
      ];
      suggested_split = _suggestSplit(allIds, separableConflicts);
    }

    return {
      overall,
      conflicts,
      reason_codes: allCodes,
      safe_ids,
      suggested_split,
    };
  }

  /**
   * Greedy AM/PM assignment.
   * Puts ingredient_a in AM and ingredient_b in PM for each separable conflict.
   * Falls back to returning null if the split is underdetermined.
   *
   * This is intentionally simple — a proper constraint solver can replace it.
   */
  function _suggestSplit(allIds, separableConflicts) {
    const am = new Set();
    const pm = new Set();

    for (const c of separableConflicts) {
      const na = _norm(c.ingredient_a);
      const nb = _norm(c.ingredient_b);
      // If already assigned to the same slot, note the remaining conflict
      if ((am.has(na) && am.has(nb)) || (pm.has(na) && pm.has(nb))) {
        continue; // can't resolve with simple split
      }
      if (!pm.has(na)) am.add(na);
      if (!am.has(nb)) pm.add(nb);
    }

    // Remaining ids go to whichever slot they're not already in
    const norm = allIds.map(_norm);
    for (const id of norm) {
      if (!am.has(id) && !pm.has(id)) am.add(id); // default AM
    }

    return {
      am: [...am].map((id) => `cosing:${id}`),
      pm: [...pm].map((id) => `cosing:${id}`),
    };
  }

  /**
   * Retrieve all interactions for a single ingredient, optionally filtered by severity.
   * Useful for product detail pages and ingredient lookup UI.
   *
   * @param {string} ingredientId
   * @param {'critical'|'high'|'moderate'|null} [severity]
   * @returns {ConflictHit[]}
   */
  function getInteractionsFor(ingredientId, severity = null) {
    const na = _norm(ingredientId);
    const rows = severity
      ? stmtSeverity.all(na, severity)
      : stmtAll.all(na);
    return rows.map(_edgeToHit);
  }

  return { checkPair, buildBasket, evaluateRoutine, getInteractionsFor };
}

module.exports = { createConflictGraph, deriveReasonCodes };
