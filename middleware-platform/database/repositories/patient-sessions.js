'use strict';

/**
 * Patient portal session repository (RS-2-03).
 */
function createPatientSessionsRepository(db) {
  return {
    createPatientSession: ({ session_id, email, patient_id = null, expires_at }) => {
      if (!session_id || !email || !expires_at) return;
      try {
        db.prepare(`
        INSERT INTO patient_sessions (session_id, email, patient_id, expires_at, created_at, last_used)
        VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
      `).run(session_id, email.toLowerCase().trim(), patient_id || null, expires_at);
      } catch (e) {
        console.error('❌ Failed to create patient_session:', e.message);
      }
    },
    getPatientSession: (session_id) => {
      if (!session_id) return null;
      try {
        return (
          db
            .prepare(
              `
        SELECT * FROM patient_sessions
        WHERE session_id = ?
      `
            )
            .get(session_id) || null
        );
      } catch (_) {
        return null;
      }
    },
    updatePatientSession: (session_id, fields = {}) => {
      if (!session_id || !fields || Object.keys(fields).length === 0) return;
      const sets = [];
      const values = [];
      if (fields.email !== undefined) {
        sets.push('email = ?');
        values.push(fields.email.toLowerCase().trim());
      }
      if (fields.patient_id !== undefined) {
        sets.push('patient_id = ?');
        values.push(fields.patient_id || null);
      }
      if (fields.expires_at !== undefined) {
        sets.push('expires_at = ?');
        values.push(fields.expires_at);
      }
      sets.push("last_used = datetime('now')");
      if (sets.length === 0) return;
      values.push(session_id);
      try {
        db.prepare(`
        UPDATE patient_sessions
        SET ${sets.join(', ')}
        WHERE session_id = ?
      `).run(...values);
      } catch (e) {
        console.error('❌ Failed to update patient_session:', e.message);
      }
    },
  };
}

module.exports = { createPatientSessionsRepository };
