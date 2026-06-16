'use strict';

/**
 * Single write path for Kelly Rails lane/step + key flags (SSOT for V2 turns).
 * Read order: kelly_rails_session_projection → session meta (hydrate.js) → triage_sessions.
 */

const db = require('../../database');

function ensureProjectionTable() {
  if (!db.db) return;
  try {
    db.db.exec(`
      CREATE TABLE IF NOT EXISTS kelly_rails_session_projection (
        session_id TEXT PRIMARY KEY,
        active_lane TEXT,
        step TEXT,
        flags_json TEXT,
        appointment_id TEXT,
        runtime TEXT DEFAULT 'kelly_rails_v2',
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_kelly_rails_proj_updated
        ON kelly_rails_session_projection(updated_at);
    `);
  } catch (_) {}
}

function persistRailsSessionState(sessionId, state = {}) {
  const sid = String(sessionId || '').trim();
  if (!sid) return;
  ensureProjectionTable();
  const flags = state.flags || {};
  const payload = {
    active_lane: state.active_lane || null,
    step: state.step || null,
    appointment_id: flags.appointment_id || null,
    triage_complete: !!flags.triage_complete,
    has_rag: !!flags.has_rag,
    safety_blocked: !!flags.safety_blocked,
    payment_complete: !!flags.payment_complete,
    routine_intake_active: !!flags.routine_intake_active,
    conversation_mode: state.conversation_mode || flags.conversation_mode || null,
    active_subrail: state.active_subrail || flags.active_subrail || null,
    active_subrail_step: state.active_subrail_step || flags.active_subrail_step || null,
    pivot_reason: flags.pivot_reason || null,
    pivot_event: flags.pivot_event || null,
    billing_step: flags.billing_step || null,
    opqrst_accumulator: flags.opqrst_accumulator || null,
    current_booking_slot: flags.current_booking_slot || null,
    cancellation_context: flags.cancellation_context || null,
    pending_intent_queue: flags.pending_intent_queue || [],
    completed_intents: flags.completed_intents || [],
    opqrst_exit_state: flags.opqrst_exit_state || null
  };
  try {
    db.db
      .prepare(
        `INSERT INTO kelly_rails_session_projection (
          session_id, active_lane, step, flags_json, appointment_id, runtime, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'kelly_rails_v2', datetime('now'))
        ON CONFLICT(session_id) DO UPDATE SET
          active_lane = excluded.active_lane,
          step = excluded.step,
          flags_json = excluded.flags_json,
          appointment_id = excluded.appointment_id,
          runtime = excluded.runtime,
          updated_at = datetime('now')`
      )
      .run(
        sid,
        payload.active_lane,
        payload.step,
        JSON.stringify(payload),
        payload.appointment_id
      );
  } catch (e) {
    if (process.env.NODE_ENV !== 'test') {
      console.warn('[kelly-rails] persistRailsSessionState failed:', e.message);
    }
  }
}

function getRailsSessionProjection(sessionId) {
  const sid = String(sessionId || '').trim();
  if (!sid || !db.db) return null;
  ensureProjectionTable();
  try {
    return db.db.prepare(`SELECT * FROM kelly_rails_session_projection WHERE session_id = ?`).get(sid) || null;
  } catch (_) {
    return null;
  }
}

function ensureAppointmentSessionColumn() {
  if (!db.db) return;
  try {
    const cols = db.db.prepare(`PRAGMA table_info(appointments)`).all();
    if (!cols.some((c) => c.name === 'triage_session_id')) {
      db.db.exec(`ALTER TABLE appointments ADD COLUMN triage_session_id TEXT`);
    }
  } catch (_) {}
}

/** Switch 3: bind Kelly session to appointment + checkout at schedule time. */
function linkSessionToAppointment(sessionId, appointmentId) {
  const sid = String(sessionId || '').trim();
  const apptId = String(appointmentId || '').trim();
  if (!sid || !apptId || !db.db) return;
  ensureAppointmentSessionColumn();
  try {
    db.db
      .prepare(
        `UPDATE appointments SET triage_session_id = ?
         WHERE id = ? AND (triage_session_id IS NULL OR triage_session_id = '')`
      )
      .run(sid, apptId);
  } catch (_) {}
  try {
    db.db
      .prepare(
        `UPDATE voice_checkouts SET triage_session_id = COALESCE(triage_session_id, ?)
         WHERE appointment_id = ?`
      )
      .run(sid, apptId);
  } catch (_) {}
  try {
    const row = db.getTriageSession?.(sid);
    if (row?.id) {
      db.db
        .prepare(`UPDATE triage_sessions SET updated_at = datetime('now') WHERE session_id = ?`)
        .run(sid);
    }
  } catch (_) {}
}

module.exports = {
  ensureProjectionTable,
  persistRailsSessionState,
  getRailsSessionProjection,
  linkSessionToAppointment
};
