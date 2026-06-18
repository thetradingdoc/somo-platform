'use strict';

const db = require('../../database');

/**
 * Idempotent confirm path: read appointment row from DB, not cached meta.
 * @returns {{ id: string, appointment_date?: string, appointment_time?: string, status?: string } | null}
 */
function readAppointmentRowById(appointmentId) {
  const id = String(appointmentId || '').trim();
  if (!id || !db.db) return null;
  try {
    return (
      db.db
        .prepare(
          `SELECT id, appointment_id, appointment_date, appointment_time, status, patient_id, clinic_id
           FROM appointments
           WHERE id = ? OR appointment_id = ?
           LIMIT 1`
        )
        .get(id, id) || null
    );
  } catch (_) {
    return null;
  }
}

function formatAppointmentWhen(row) {
  if (!row) return '';
  return [row.appointment_date, row.appointment_time].filter(Boolean).join(' at ');
}

module.exports = {
  readAppointmentRowById,
  formatAppointmentWhen
};
