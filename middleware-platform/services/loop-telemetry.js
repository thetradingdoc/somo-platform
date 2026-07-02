'use strict';

const db = require('../database');

function recordShadowTelemetry({ sessionId, clinicId, field, expected, actual } = {}) {
  const mismatch = expected != null && actual != null && String(expected) !== String(actual);
  console.log(
    JSON.stringify({
      component: 'shadow_telemetry',
      session_id: sessionId,
      clinic_id: clinicId,
      field,
      expected,
      actual,
      mismatch
    })
  );
  if (mismatch && db.db) {
    try {
      db.db
        .prepare(
          `
          INSERT INTO amount_resolution_log (id, session_id, quoted_amount, source, status, details_json, created_at)
          VALUES (?, ?, ?, 'shadow_compare', 'mismatch', ?, datetime('now'))
        `
        )
        .run(
          `shadow_${sessionId}_${Date.now()}`,
          sessionId,
          actual,
          JSON.stringify({ field, expected, actual })
        );
    } catch (_) {}
  }
  return { mismatch };
}

function recordStediDownHandoff({ sessionId, clinicId, reason } = {}) {
  console.log(
    JSON.stringify({
      component: 'stedi_down_handoff',
      session_id: sessionId,
      clinic_id: clinicId,
      reason: reason || 'stedi_unavailable'
    })
  );
  return { handoff: true, reason: reason || 'stedi_unavailable' };
}

module.exports = { recordShadowTelemetry, recordStediDownHandoff };
