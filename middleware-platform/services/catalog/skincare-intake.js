'use strict';

/**
 * Thin placeholder for Block 4 tests and future Skin & Care intake schema.
 * Replace when first-class columns + validation ship (see kelly-god-object-fix-todos).
 */

function createIntakeSession({ patient_id } = {}) {
  return {
    patient_id: patient_id ?? null,
    chief_complaint: '',
    history: '',
    current_products: [],
    media_refs: [],
    cycle_data: {},
    intake_complete: false,
    consent_flags: {}
  };
}

function validateIntakeComplete(_session) {
  return { ok: false, missing: [] };
}

module.exports = {
  createIntakeSession,
  validateIntakeComplete
};
