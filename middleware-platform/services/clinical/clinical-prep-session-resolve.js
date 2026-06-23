'use strict';

const db = require('../../database');

/**
 * Resolve triage session_id for an appointment (V6-1).
 * Order: case_summaries → voice_checkouts → appointment notes JSON → case_records by patient.
 */
function resolveTriageSessionIdForAppointment(appointmentId, apptRow = null) {
  const apptId = String(appointmentId || '').trim();
  if (!apptId) return null;

  try {
    const cs = db.db.prepare('SELECT session_id FROM case_summaries WHERE appointment_id = ? LIMIT 1').get(apptId);
    if (cs?.session_id) return cs.session_id;
  } catch (_) {}

  try {
    const vc = db.db
      .prepare(
        `SELECT triage_session_id FROM voice_checkouts WHERE appointment_id = ? AND triage_session_id IS NOT NULL ORDER BY created_at DESC LIMIT 1`
      )
      .get(apptId);
    if (vc?.triage_session_id) return vc.triage_session_id;
  } catch (_) {}

  let row = apptRow || null;
  if (!row && db.getAppointment) {
    try {
      const maybe = db.getAppointment(apptId);
      row = maybe && typeof maybe.then === 'function' ? null : maybe;
    } catch (_) {}
  }
  if (!row && db.db) {
    try {
      row = db.db.prepare('SELECT * FROM appointments WHERE id = ? LIMIT 1').get(apptId);
    } catch (_) {}
  }

  if (row?.notes) {
    try {
      const notes = typeof row.notes === 'string' ? JSON.parse(row.notes) : row.notes;
      const sid = notes?.session_id || notes?.triage_session_id || notes?.metadata?.session_id;
      if (sid) return String(sid);
    } catch (_) {
      const m = String(row.notes).match(/session[_-]?id["']?\s*[:=]\s*["']?([a-zA-Z0-9_-]+)/i);
      if (m?.[1]) return m[1];
    }
  }

  const patientId = row?.patient_id;
  if (patientId) {
    try {
      const cr = db.db
        .prepare(
          `SELECT session_id FROM case_records WHERE patient_id = ? AND session_id IS NOT NULL ORDER BY created_at DESC LIMIT 1`
        )
        .get(patientId);
      if (cr?.session_id) return cr.session_id;
    } catch (_) {}
  }

  return null;
}

module.exports = {
  resolveTriageSessionIdForAppointment
};
