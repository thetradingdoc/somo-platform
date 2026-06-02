'use strict';

const db = require('../database');

/**
 * Build and persist case_summaries row (shared by Stripe webhook + schedule_appointment).
 */
function persistCaseSummaryForAppointment({ appointmentId, sessionId, practitionerId = null }) {
  if (!appointmentId || !sessionId) return { ok: false, reason: 'missing_ids' };

  const session = db.getTriageSession ? db.getTriageSession(sessionId) : null;
  if (!session) return { ok: false, reason: 'no_triage_session' };

  let appt = null;
  try {
    appt = db.db.prepare('SELECT * FROM appointments WHERE id = ? LIMIT 1').get(appointmentId);
  } catch (_) {}

  const summary = {
    appointment_id: appointmentId,
    session_id: sessionId,
    practitioner_id: practitionerId || appt?.practitioner_id || null,
    built_at: new Date().toISOString(),
    chief_complaint: appt?.notes || session.soap_note || session.quality || '',
    target_specialty: session.target_specialty,
    urgency: session.urgency,
    safety_level: session.safety_level,
    soap_note: session.soap_note,
    opqrst: {
      onset: session.onset,
      provocation: session.provocation,
      quality: session.quality,
      radiation: session.radiation,
      severity: session.severity,
      timing: session.timing,
      associated_sx: session.associated_sx
    },
    intake: {
      medications: session.medications,
      allergies: session.allergies,
      prior_diagnoses: session.prior_diagnoses,
      prior_workups: session.prior_workups,
      family_history: session.family_history,
      alcohol_use: session.alcohol_use,
      smoking_status: session.smoking_status
    },
    scores: {
      phq2: session.phq2_score,
      gad2: session.gad2_score,
      safety_screen: session.safety_screen,
      alcohol_cage: session.alcohol_cage_score
    }
  };

  try {
    db.db.prepare(`
      INSERT OR REPLACE INTO case_summaries
        (appointment_id, session_id, practitioner_id, summary_json, created_at)
      VALUES (?, ?, ?, ?, datetime('now'))
    `).run(
      appointmentId,
      sessionId,
      summary.practitioner_id,
      JSON.stringify(summary)
    );
    return { ok: true, appointmentId, sessionId };
  } catch (err) {
    try {
      db.db.prepare(`
        CREATE TABLE IF NOT EXISTS case_summaries (
          appointment_id  TEXT PRIMARY KEY,
          session_id      TEXT,
          practitioner_id TEXT,
          summary_json    TEXT,
          created_at      TEXT DEFAULT (datetime('now'))
        )
      `).run();
      db.db.prepare(`
        INSERT OR REPLACE INTO case_summaries
          (appointment_id, session_id, practitioner_id, summary_json, created_at)
        VALUES (?, ?, ?, ?, datetime('now'))
      `).run(
        appointmentId,
        sessionId,
        summary.practitioner_id,
        JSON.stringify(summary)
      );
      return { ok: true, appointmentId, sessionId };
    } catch (err2) {
      console.warn('[CaseSummaryService] persist failed:', err2.message);
      return { ok: false, reason: err2.message };
    }
  }
}

module.exports = {
  persistCaseSummaryForAppointment
};
