'use strict';

/**
 * Patient orchestrate session repository (RS-2-03).
 */
function createOrchestrateSessionsRepository(db) {
  return {
    getOrchestrateSessionBySessionId: (session_id) => {
      if (!session_id) return null;
      try {
        const row = db.prepare('SELECT * FROM patient_orchestrate_sessions WHERE session_id = ?').get(session_id);
        return row
          ? {
              ...row,
              conversation_history: row.conversation_history ? JSON.parse(row.conversation_history) : [],
              flow_state: row.flow_state ? JSON.parse(row.flow_state) : {},
            }
          : null;
      } catch (_) {
        return null;
      }
    },
    getOrchestrateSessionByCallerPhone: (caller_phone, opts = {}) => {
      if (!caller_phone) return null;
      try {
        const norm = String(caller_phone).replace(/\D/g, '');
        if (norm.length < 6) return null;
        const clinicId = opts.clinicId || opts.clinic_id || null;
        const customerId = opts.customerId || opts.customer_id || null;
        const requireClinicScope = opts.requireClinicScope === true;
        if (requireClinicScope && !clinicId) return null;

        let sql = `SELECT * FROM patient_orchestrate_sessions
        WHERE REPLACE(REPLACE(REPLACE(caller_phone, '-', ''), ' ', ''), '+', '') LIKE ?
        AND status = ?`;
        const params = [`%${norm.slice(-10)}%`, 'active'];
        if (clinicId) {
          sql += ' AND clinic_id = ?';
          params.push(clinicId);
        }
        if (customerId) {
          sql += ' AND (flow_state LIKE ? OR flow_state IS NULL)';
          params.push(`%"customer_id":"${customerId}"%`);
        }
        sql += ' ORDER BY last_activity_at DESC LIMIT 1';
        const rows = db.prepare(sql).all(...params);
        const row = rows && rows[0];
        return row
          ? {
              ...row,
              conversation_history: row.conversation_history ? JSON.parse(row.conversation_history) : [],
              flow_state: row.flow_state ? JSON.parse(row.flow_state) : {},
            }
          : null;
      } catch (_) {
        return null;
      }
    },
    upsertOrchestrateSession: (data) => {
      try {
        const id = data.id || require('uuid').v4();
        const session_id = data.session_id || id;
        const now = new Date().toISOString();
        const history = JSON.stringify(data.conversation_history || []);
        const flow_state = JSON.stringify(data.flow_state || {});
        const case_id = data.case_id || (data.flow_state && data.flow_state.case_id) || null;
        const forceClinicSync = !!(data.force_clinic_sync || data.verified_site_upsert);
        const clinicUpdate = forceClinicSync
          ? 'clinic_id = excluded.clinic_id,'
          : 'clinic_id = COALESCE(excluded.clinic_id, patient_orchestrate_sessions.clinic_id),';
        db.prepare(`
        INSERT INTO patient_orchestrate_sessions (id, session_id, channel, patient_id, caller_phone, portal_session_id, clinic_id, preferred_language, turn_count, conversation_history, flow_state, case_id, status, created_at, updated_at, last_activity_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(session_id) DO UPDATE SET
          patient_id = COALESCE(excluded.patient_id, patient_orchestrate_sessions.patient_id),
          caller_phone = COALESCE(excluded.caller_phone, patient_orchestrate_sessions.caller_phone),
          portal_session_id = COALESCE(excluded.portal_session_id, patient_orchestrate_sessions.portal_session_id),
          ${clinicUpdate}
          preferred_language = COALESCE(excluded.preferred_language, patient_orchestrate_sessions.preferred_language),
          turn_count = excluded.turn_count,
          conversation_history = excluded.conversation_history,
          flow_state = excluded.flow_state,
          case_id = COALESCE(excluded.case_id, patient_orchestrate_sessions.case_id),
          status = COALESCE(excluded.status, patient_orchestrate_sessions.status),
          updated_at = excluded.updated_at,
          last_activity_at = excluded.last_activity_at
      `).run(
          id,
          session_id,
          data.channel || 'chat',
          data.patient_id || null,
          data.caller_phone || null,
          data.portal_session_id || null,
          data.clinic_id || null,
          data.preferred_language || 'en',
          data.turn_count || 0,
          history,
          flow_state,
          case_id,
          data.status || 'active',
          now,
          now,
          now
        );
        return { id, session_id };
      } catch (e) {
        console.error('❌ Failed to upsert orchestrate session:', e.message);
        throw e;
      }
    },
  };
}

module.exports = { createOrchestrateSessionsRepository };
