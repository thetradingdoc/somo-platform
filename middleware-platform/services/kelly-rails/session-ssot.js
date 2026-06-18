'use strict';

/**
 * Single write path for Kelly Rails lane/step + key flags (SSOT for V2 turns).
 * Read order: kelly_rails_session_projection → session meta (hydrate.js) → triage_sessions.
 */

const db = require('../../database');
const KellyToolExecutor = require('../kelly-tool-executor');

function laneToOrchestratorPhase(lane) {
  const map = {
    clinical: 'TRIAGE_ACTIVE',
    booking: 'BOOKING',
    payment: 'BILLING',
    basic_intake: 'TRIAGE_DISCOVERY',
    education: 'ROUTINE_INTAKE',
    support: 'BILLING',
    account: 'BILLING',
    records: 'BILLING',
    reschedule: 'BOOKING'
  };
  return map[String(lane || '').toLowerCase()] || 'TRIAGE_DISCOVERY';
}

function mirrorMetaFromPayload(sessionId, payload = {}) {
  const sid = String(sessionId || '').trim();
  if (!sid) return;
  try {
    KellyToolExecutor._setSessionMeta(sid, 'kelly_rails_v2', '1');
    KellyToolExecutor._setSessionMeta(sid, 'kelly_graph_active', '1');
    const exportLane = String(payload.active_lane || '');
    if (exportLane) {
      KellyToolExecutor._setSessionMeta(sid, 'kelly_graph_branch', exportLane);
      KellyToolExecutor._setSessionMeta(sid, 'kelly_orchestrator_phase', laneToOrchestratorPhase(exportLane));
    }
    if (payload.active_subrail) {
      KellyToolExecutor._setSessionMeta(sid, 'active_subrail', payload.active_subrail);
    }
    if (payload.conversation_mode) {
      KellyToolExecutor._setSessionMeta(sid, 'conversation_mode', payload.conversation_mode);
    }
    if (payload.last_appointment_id) {
      KellyToolExecutor._setSessionMeta(sid, 'last_appointment_id', payload.last_appointment_id);
    }
    if (payload.locale) {
      KellyToolExecutor._setSessionMeta(sid, 'kelly_session_locale', payload.locale);
    }
    if (payload.step) {
      KellyToolExecutor._setSessionMeta(sid, 'kelly_graph_step', payload.step);
    }
    if (payload.gate_matched) {
      KellyToolExecutor._setSessionMeta(sid, 'last_gate_matched', payload.gate_matched);
    }
  } catch (_) {}
}

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

function ensurePostgresProjectionTable(sql) {
  return sql`
    CREATE TABLE IF NOT EXISTS kelly_rails_session_projection (
      session_id TEXT PRIMARY KEY,
      active_lane TEXT,
      step TEXT,
      flags_json JSONB,
      appointment_id TEXT,
      runtime TEXT DEFAULT 'kelly_rails_v2',
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
}

function postgresSsotEnabled() {
  return !!(process.env.POSTGRES_URL && process.env.KELLY_RAILS_SSOT_POSTGRES === '1');
}

async function mirrorProjectionToPostgres(sessionId, payload) {
  if (!postgresSsotEnabled()) return;
  try {
    const { createPool } = require('../../utils/postgres');
    const sql = createPool();
    await ensurePostgresProjectionTable(sql);
    await sql`
      INSERT INTO kelly_rails_session_projection (
        session_id, active_lane, step, flags_json, appointment_id, runtime, updated_at
      ) VALUES (
        ${sessionId},
        ${payload.active_lane},
        ${payload.step},
        ${sql.json(payload)},
        ${payload.appointment_id},
        'kelly_rails_v2',
        NOW()
      )
      ON CONFLICT (session_id) DO UPDATE SET
        active_lane = EXCLUDED.active_lane,
        step = EXCLUDED.step,
        flags_json = EXCLUDED.flags_json,
        appointment_id = EXCLUDED.appointment_id,
        runtime = EXCLUDED.runtime,
        updated_at = NOW()
    `;
  } catch (e) {
    if (process.env.NODE_ENV !== 'test') {
      console.warn('[kelly-rails] postgres projection mirror failed:', e.message);
    }
  }
}

async function getRailsSessionProjectionFromPostgres(sessionId) {
  if (!postgresSsotEnabled()) return null;
  try {
    const { createPool } = require('../../utils/postgres');
    const sql = createPool();
    await ensurePostgresProjectionTable(sql);
    const rows = await sql`
      SELECT * FROM kelly_rails_session_projection WHERE session_id = ${sessionId} LIMIT 1
    `;
    return rows[0] || null;
  } catch (_) {
    return null;
  }
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
    opqrst_exit_state: flags.opqrst_exit_state || null,
    appt_lookup_only: !!flags.appt_lookup_only,
    schedule_appointment_success: !!flags.schedule_appointment_success,
    lookup_complete: !!flags.lookup_complete,
    cancel_complete: !!flags.cancel_complete,
    rebook_after_cancel: !!flags.rebook_after_cancel,
    reschedule_pending: !!flags.reschedule_pending,
    reschedule_complete: !!flags.reschedule_complete,
    booking_conflict: !!flags.booking_conflict,
    provider_mismatch: !!flags.provider_mismatch,
    provider_preference: flags.provider_preference || null,
    last_appointment_id: flags.last_appointment_id || flags.appointment_id || null,
    outbound_purpose: flags.outbound_purpose || null,
    locale: state.locale || flags.locale || null,
    gate_matched: state.gate_matched || flags.gate_matched || null,
    gate_outcome: state.gate_outcome || flags.gate_outcome || null,
    opqrst_from_triage: flags.opqrst_from_triage || null
  };
  try {
    const write = () => {
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
      mirrorMetaFromPayload(sid, payload);
      mirrorProjectionToPostgres(sid, payload).catch(() => {});
    };
    if (typeof db.db.transaction === 'function') {
      db.db.transaction(write)();
    } else {
      write();
    }
  } catch (e) {
    if (process.env.NODE_ENV !== 'test') {
      console.warn('[kelly-rails] persistRailsSessionState failed:', e.message);
    }
  }
}

/** Strip L4-owned slot fields from L2 dispatch updates; persist in one transaction. */
function mergeConversationStateUpdates(sessionId, sessionFields = {}, dispatchUpdates = {}) {
  const sid = String(sessionId || '').trim();
  if (!sid) return { ...sessionFields, ...dispatchUpdates };

  const merged = { ...sessionFields, ...dispatchUpdates };
  if (merged.current_booking_slot && !merged.schedule_appointment_success) {
    delete merged.current_booking_slot;
  }

  persistRailsSessionState(sid, {
    active_lane: merged.kelly_lane_hint || merged.active_lane || null,
    step: merged.active_subrail_step || merged.step || null,
    conversation_mode: merged.conversation_mode || null,
    active_subrail: merged.active_subrail || null,
    flags: merged
  });
  return merged;
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

/** CR-024: collapse duplicate triage_sessions rows sharing the same session_id. */
function ensureUniqueTriageSessionId(sessionId) {
  const sid = String(sessionId || '').trim();
  if (!sid || !db.db) return null;
  try {
    const rows = db.db
      .prepare(`SELECT id FROM triage_sessions WHERE session_id = ? ORDER BY datetime(created_at) ASC`)
      .all(sid);
    if (!rows.length) return null;
    const keepId = rows[0].id;
    if (rows.length > 1) {
      const del = db.db.prepare(`DELETE FROM triage_sessions WHERE id = ?`);
      for (let i = 1; i < rows.length; i++) {
        del.run(rows[i].id);
      }
    }
    return keepId;
  } catch (_) {
    return null;
  }
}

/** Sync triage_sessions clinical fields into rails projection flags (OPQRST → booking pivot). */
function syncTriageFieldsToProjection(sessionId, extraFlags = {}) {
  const sid = String(sessionId || '').trim();
  if (!sid) return;
  ensureUniqueTriageSessionId(sid);
  const row = db.getTriageSession ? db.getTriageSession(sid) : null;
  if (!row) return;
  const projection = getRailsSessionProjection(sid);
  let existing = {};
  if (projection?.flags_json) {
    try {
      existing = JSON.parse(projection.flags_json);
    } catch (_) {}
  }
  const flags = {
    ...existing,
    ...extraFlags,
    triage_complete: !!(row.triage_complete === 1 || row.triage_complete === true),
    has_rag: !!(row.rag_result_id || existing.has_rag),
    target_specialty: row.target_specialty || existing.target_specialty || null,
    opqrst_from_triage: {
      quality: row.quality || null,
      region: row.region || row.body_site || null,
      onset: row.onset || row.timing || null,
      severity: row.severity ?? null
    }
  };
  persistRailsSessionState(sid, {
    active_lane: projection?.active_lane || extraFlags.active_lane || 'booking',
    step: projection?.step || extraFlags.step || null,
    active_subrail: extraFlags.active_subrail || existing.active_subrail || 'booking',
    flags
  });
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
  getRailsSessionProjectionFromPostgres,
  postgresSsotEnabled,
  linkSessionToAppointment,
  mirrorMetaFromPayload,
  mergeConversationStateUpdates,
  ensureUniqueTriageSessionId,
  syncTriageFieldsToProjection
};
