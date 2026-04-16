'use strict';

/**
 * services/session-state.js
 *
 * Layer A input: persistent skin profile + current routine per user.
 */

const VALID_GOALS = new Set(['brighten', 'hydrate', 'anti_aging', 'acne', 'even_tone', 'barrier']);
const VALID_SENSITIVITY = new Set(['none', 'mild', 'moderate', 'severe']);
const VALID_CONTRAINDICATIONS = new Set([
  'pregnant', 'breastfeeding', 'on_rx_retinoid', 'on_isotretinoin',
  'on_chemotherapy', 'eczema_active', 'rosacea_active',
]);
const VALID_TIMES = new Set(['am', 'pm']);
const VALID_EXPOSURE = new Set(['indoor', 'outdoor', 'unknown']);
const { enrichCurrentRoutineWithCatalogRoles } = require('./product-role-inference');

/** A2 — explicit role on product, or unknown (filled from catalog on read when possible) */
const VALID_PRODUCT_ROLES = new Set([
  'unknown',
  'cleanser',
  'toner',
  'serum',
  'moisturizer',
  'sunscreen',
  'treatment',
  'mask',
  'oil',
  'other',
]);

function _boolOr(v, defaultVal) {
  if (v === undefined || v === null) return defaultVal;
  return Boolean(v);
}

function _validateGoals(arr) {
  if (!Array.isArray(arr)) throw new TypeError('skin_goals must be an array');
  for (const g of arr) {
    if (!VALID_GOALS.has(g)) throw new RangeError(`unknown skin_goal: "${g}"`);
  }
  return [...new Set(arr)];
}
function _validateSensitivity(s) {
  if (!VALID_SENSITIVITY.has(s)) throw new RangeError(`unknown sensitivity: "${s}"`);
  return s;
}
function _validateContraindications(arr) {
  if (!Array.isArray(arr)) throw new TypeError('contraindications must be an array');
  for (const c of arr) {
    if (!VALID_CONTRAINDICATIONS.has(c)) throw new RangeError(`unknown contraindication: "${c}"`);
  }
  return [...new Set(arr)];
}
function _validateRoutine(slots) {
  if (!Array.isArray(slots)) throw new TypeError('current_routine must be an array');
  return slots.map((slot, i) => {
    if (!VALID_TIMES.has(slot.time)) throw new RangeError(`slot[${i}].time must be am|pm`);
    const stepOrder =
      slot.step_order !== undefined && slot.step_order !== null
        ? Number(slot.step_order)
        : i * 10;
    if (!Number.isFinite(stepOrder)) throw new RangeError(`slot[${i}].step_order must be a number`);
    if (!Array.isArray(slot.products)) throw new TypeError(`slot[${i}].products must be an array`);
    return {
      time: slot.time,
      step_order: stepOrder,
      products: slot.products.map((p) => {
        const washOff = _boolOr(p.wash_off, false);
        const leaveOn = washOff ? false : _boolOr(p.leave_on, true);
        let exposure = 'unknown';
        if (p.exposure !== undefined && p.exposure !== null) {
          const ex = String(p.exposure);
          if (!VALID_EXPOSURE.has(ex)) throw new RangeError(`unknown exposure: "${ex}"`);
          exposure = ex;
        }
        let role = 'unknown';
        if (p.role !== undefined && p.role !== null) {
          const r = String(p.role);
          if (!VALID_PRODUCT_ROLES.has(r)) throw new RangeError(`unknown product role: "${r}"`);
          role = r;
        }
        return {
          product_id: String(p.product_id || ''),
          name: String(p.name || ''),
          ingredient_ids: Array.isArray(p.ingredient_ids) ? p.ingredient_ids.map(String) : [],
          wash_off: washOff,
          leave_on: leaveOn,
          exposure,
          role,
        };
      }),
    };
  });
}

function createSessionStateService(db) {
  const stmtGet = db.prepare(
    'SELECT * FROM user_sessions WHERE id = ?'
  );
  const stmtUpsert = db.prepare(`
    INSERT INTO user_sessions
      (id, skin_goals, sensitivity, contraindications, current_routine, scan_data, journal_data, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET
      skin_goals        = excluded.skin_goals,
      sensitivity       = excluded.sensitivity,
      contraindications = excluded.contraindications,
      current_routine   = excluded.current_routine,
      scan_data         = excluded.scan_data,
      journal_data      = excluded.journal_data,
      updated_at        = CURRENT_TIMESTAMP
  `);

  function get(sessionId) {
    const row = stmtGet.get(String(sessionId || ''));
    if (!row) return _defaults(sessionId);
    return _parse(row);
  }

  function set(sessionId, patch) {
    const existing = get(sessionId);
    const merged = _merge(existing, patch);
    _write(sessionId, merged);
    return merged;
  }

  function merge(sessionId, patch) {
    return set(sessionId, patch);
  }

  function getAllIngredientIds(sessionId) {
    const { current_routine } = get(sessionId);
    const ids = current_routine.flatMap((slot) =>
      slot.products.flatMap((p) => p.ingredient_ids)
    );
    return [...new Set(ids)];
  }

  function _mapRoutineToSlots(current_routine) {
    return current_routine.map((slot, slotIdx) => ({
      time: slot.time,
      step_order: slot.step_order != null ? slot.step_order : slotIdx * 10,
      ingredient_ids: slot.products.flatMap((p) => p.ingredient_ids),
      steps: slot.products.map((p, j) => ({
        order: j,
        ingredient_ids: p.ingredient_ids,
        wash_off: p.wash_off === true,
        leave_on: p.leave_on !== false && p.wash_off !== true,
        exposure: p.exposure || 'unknown',
        role: p.role || 'unknown',
      })),
    }));
  }

  function toRoutineSlots(sessionId) {
    const { current_routine } = get(sessionId);
    const enriched = enrichCurrentRoutineWithCatalogRoles(db, current_routine);
    return _mapRoutineToSlots(enriched);
  }

  /** Compact session summary for composer / Kelly system prompts (A5). */
  function getContextBundle(sessionId) {
    if (sessionId == null || String(sessionId).trim() === '') return null;
    const state = get(sessionId);
    let hasOutdoor = false;
    for (const slot of state.current_routine || []) {
      for (const p of slot.products || []) {
        if (p.exposure === 'outdoor') hasOutdoor = true;
      }
    }
    return {
      skin_goals: state.skin_goals,
      sensitivity: state.sensitivity,
      contraindications: state.contraindications,
      routine_slot_count: state.current_routine.length,
      has_outdoor_exposure_step: hasOutdoor,
      has_scan: !!state.scan_data,
      has_journal: !!state.journal_data,
    };
  }

  /**
   * Slots ready for evaluateRoutine(), plus contraindication flags.
   * (Ingredient-level stripping is not applied — contraindications here are clinical flags.)
   */
  function getRoutineForEvaluation(sessionId) {
    if (sessionId == null || String(sessionId).trim() === '') return null;
    const state = get(sessionId);
    const enriched = enrichCurrentRoutineWithCatalogRoles(db, state.current_routine);
    return {
      slots: _mapRoutineToSlots(enriched),
      contraindications: state.contraindications,
      context_bundle: getContextBundle(sessionId),
    };
  }

  function _defaults(id) {
    return {
      id: String(id || ''),
      skin_goals: [],
      sensitivity: 'none',
      contraindications: [],
      current_routine: [],
      scan_data: null,
      journal_data: null,
    };
  }

  function _parse(row) {
    return {
      id: row.id,
      skin_goals: _safeJson(row.skin_goals, []),
      sensitivity: row.sensitivity || 'none',
      contraindications: _safeJson(row.contraindications, []),
      current_routine: _safeJson(row.current_routine, []),
      scan_data: _safeJson(row.scan_data, null),
      journal_data: _safeJson(row.journal_data, null),
      updated_at: row.updated_at,
    };
  }

  function _safeJson(str, fallback) {
    if (!str) return fallback;
    try { return JSON.parse(str); } catch (_) { return fallback; }
  }

  function _merge(existing, patch) {
    const out = { ...existing };
    if (patch.skin_goals !== undefined)
      out.skin_goals = _validateGoals(patch.skin_goals);
    if (patch.sensitivity !== undefined)
      out.sensitivity = _validateSensitivity(patch.sensitivity);
    if (patch.contraindications !== undefined)
      out.contraindications = _validateContraindications(patch.contraindications);
    if (patch.current_routine !== undefined)
      out.current_routine = _validateRoutine(patch.current_routine);
    if (patch.scan_data !== undefined) out.scan_data = patch.scan_data;
    if (patch.journal_data !== undefined) out.journal_data = patch.journal_data;
    return out;
  }

  function _write(sessionId, state) {
    stmtUpsert.run(
      String(sessionId),
      JSON.stringify(state.skin_goals),
      state.sensitivity,
      JSON.stringify(state.contraindications),
      JSON.stringify(state.current_routine),
      state.scan_data ? JSON.stringify(state.scan_data) : null,
      state.journal_data ? JSON.stringify(state.journal_data) : null,
    );
  }

  return {
    get,
    set,
    merge,
    getAllIngredientIds,
    toRoutineSlots,
    getContextBundle,
    getRoutineForEvaluation,
  };
}

module.exports = {
  createSessionStateService,
  VALID_GOALS,
  VALID_SENSITIVITY,
  VALID_CONTRAINDICATIONS,
  VALID_EXPOSURE,
  VALID_PRODUCT_ROLES,
};
