'use strict';

const { resolveTriageSessionIdForAppointment } = require('../services/clinical-prep-session-resolve');

describe('clinical-prep-session-resolve', () => {
  it('returns session_id from case_summaries when present', () => {
    const db = require('../database');
    const apptId = `appt_resolve_${Date.now()}`;
    const sessionId = `sess_resolve_${Date.now()}`;

    try {
      db.db.prepare(`
        INSERT OR REPLACE INTO case_summaries (appointment_id, session_id, practitioner_id, summary_json, created_at)
        VALUES (?, ?, NULL, '{}', datetime('now'))
      `).run(apptId, sessionId);

      expect(resolveTriageSessionIdForAppointment(apptId)).toBe(sessionId);
    } finally {
      try {
        db.db.prepare('DELETE FROM case_summaries WHERE appointment_id = ?').run(apptId);
      } catch (_) {}
    }
  });
});
