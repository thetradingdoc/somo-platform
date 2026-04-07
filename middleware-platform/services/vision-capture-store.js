const db = require('../database');
const crypto = require('crypto');

function ensureVisionCaptureTables() {
  try {
    db.db.exec(`
      CREATE TABLE IF NOT EXISTS vision_capture_checklist (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        requested_region TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        attempts INTEGER NOT NULL DEFAULT 0,
        best_frame_url TEXT,
        quality_score REAL,
        provider_review_required INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS vision_capture_events (
        id TEXT PRIMARY KEY,
        session_id TEXT,
        event_type TEXT NOT NULL,
        idempotency_key TEXT,
        trace_id TEXT,
        actor TEXT,
        payload_json TEXT NOT NULL,
        processed_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_vc_checklist_session_region
        ON vision_capture_checklist(session_id, requested_region);
      CREATE INDEX IF NOT EXISTS idx_vc_checklist_session_status
        ON vision_capture_checklist(session_id, status);
      CREATE INDEX IF NOT EXISTS idx_vc_events_session_created
        ON vision_capture_events(session_id, created_at);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_vc_events_event_idem
        ON vision_capture_events(event_type, idempotency_key);

      CREATE TABLE IF NOT EXISTS vision_capture_artifacts (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        requested_region TEXT NOT NULL,
        frame_url TEXT NOT NULL,
        quality_score REAL,
        quality_band TEXT,
        provider_review_required INTEGER NOT NULL DEFAULT 0,
        consent_acknowledged INTEGER NOT NULL DEFAULT 0,
        storage_encrypted INTEGER NOT NULL DEFAULT 0,
        signed_url_expires_at TEXT,
        retention_expires_at TEXT,
        access_policy TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_vc_artifacts_session_region
        ON vision_capture_artifacts(session_id, requested_region);
    `);
  } catch (e) {
    console.warn('[vision-capture-store] ensure tables failed:', e.message);
  }
}

function _stableHash(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function _eventId(prefix = 'vce') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function insertVisionCaptureEvent({
  event_type,
  session_id = null,
  trace_id = null,
  actor = 'system',
  payload = {},
  idempotency_key = null
} = {}) {
  try {
    const payloadJson = JSON.stringify(payload || {});
    const idem =
      (String(idempotency_key || '').trim() || null) ||
      _stableHash(`${event_type}|${session_id || ''}|${payloadJson}`);
    const id = _eventId();
    const stmt = db.db.prepare(`
      INSERT OR IGNORE INTO vision_capture_events
        (id, session_id, event_type, idempotency_key, trace_id, actor, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `);
    const result = stmt.run(id, session_id, event_type, idem, trace_id, actor, payloadJson);
    if (result.changes === 0) {
      const existing = db.db
        .prepare(`SELECT * FROM vision_capture_events WHERE event_type = ? AND idempotency_key = ? LIMIT 1`)
        .get(event_type, idem);
      return { success: true, duplicate: true, id: existing?.id || null, event: existing || null, idempotency_key: idem };
    }
    return { success: true, duplicate: false, id, idempotency_key: idem };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function markVisionEventProcessed(id) {
  try {
    db.db.prepare(`UPDATE vision_capture_events SET processed_at = datetime('now') WHERE id = ?`).run(id);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function claimNextRequestedEvent() {
  try {
    const row = db.db.prepare(`
      SELECT *
      FROM vision_capture_events
      WHERE event_type = 'vision_capture_requested'
        AND processed_at IS NULL
      ORDER BY created_at ASC
      LIMIT 1
    `).get();
    if (!row) return null;
    db.db.prepare(`UPDATE vision_capture_events SET processed_at = datetime('now') WHERE id = ? AND processed_at IS NULL`).run(row.id);
    return row;
  } catch (e) {
    console.warn('[vision-capture-store] claim requested failed:', e.message);
    return null;
  }
}

function upsertChecklistRow({
  session_id,
  requested_region,
  status = 'pending',
  attempts = 0,
  best_frame_url = null,
  quality_score = null,
  provider_review_required = false
} = {}) {
  if (!session_id || !requested_region) return { success: false, error: 'session_id and requested_region required' };
  try {
    const id = `vcc_${_stableHash(`${session_id}|${requested_region}`)}`;
    const existing = db.db.prepare(`SELECT * FROM vision_capture_checklist WHERE id = ?`).get(id);
    if (!existing) {
      db.db.prepare(`
        INSERT INTO vision_capture_checklist
          (id, session_id, requested_region, status, attempts, best_frame_url, quality_score, provider_review_required, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      `).run(
        id,
        session_id,
        requested_region,
        status,
        attempts || 0,
        best_frame_url || null,
        quality_score == null ? null : Number(quality_score),
        provider_review_required ? 1 : 0
      );
    } else {
      db.db.prepare(`
        UPDATE vision_capture_checklist
        SET status = ?,
            attempts = ?,
            best_frame_url = ?,
            quality_score = ?,
            provider_review_required = ?,
            updated_at = datetime('now')
        WHERE id = ?
      `).run(
        status,
        attempts == null ? existing.attempts : Number(attempts),
        best_frame_url == null ? existing.best_frame_url : best_frame_url,
        quality_score == null ? existing.quality_score : Number(quality_score),
        provider_review_required ? 1 : 0,
        id
      );
    }
    return { success: true, id };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function getChecklistRow(session_id, requested_region) {
  if (!session_id || !requested_region) return null;
  try {
    const id = `vcc_${_stableHash(`${session_id}|${requested_region}`)}`;
    return db.db.prepare(`SELECT * FROM vision_capture_checklist WHERE id = ? LIMIT 1`).get(id) || null;
  } catch (_) {
    return null;
  }
}

function listChecklistBySession(session_id) {
  if (!session_id) return [];
  try {
    return db.db
      .prepare(`
        SELECT *
        FROM vision_capture_checklist
        WHERE session_id = ?
        ORDER BY updated_at DESC
      `)
      .all(session_id);
  } catch (_) {
    return [];
  }
}

function getLatestVisionGuidance(session_id) {
  if (!session_id) return null;
  try {
    const row = db.db
      .prepare(`
        SELECT *
        FROM vision_capture_events
        WHERE session_id = ?
          AND event_type = 'vision_capture_guidance'
        ORDER BY created_at DESC
        LIMIT 1
      `)
      .get(session_id);
    if (!row) return null;
    return {
      ...row,
      payload: row.payload_json ? JSON.parse(row.payload_json) : null
    };
  } catch (_) {
    return null;
  }
}

function insertVisionArtifact({
  session_id,
  requested_region,
  frame_url,
  quality_score = null,
  quality_band = null,
  provider_review_required = false,
  consent_acknowledged = false,
  storage_encrypted = false,
  signed_url_expires_at = null,
  retention_expires_at = null,
  access_policy = null
} = {}) {
  if (!session_id || !requested_region || !frame_url) return { success: false, error: 'session_id/requested_region/frame_url required' };
  try {
    const id = `vca_${_eventId('art')}`;
    db.db.prepare(`
      INSERT INTO vision_capture_artifacts
        (id, session_id, requested_region, frame_url, quality_score, quality_band, provider_review_required, consent_acknowledged, storage_encrypted, signed_url_expires_at, retention_expires_at, access_policy, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(
      id,
      session_id,
      requested_region,
      frame_url,
      quality_score == null ? null : Number(quality_score),
      quality_band || null,
      provider_review_required ? 1 : 0,
      consent_acknowledged ? 1 : 0,
      storage_encrypted ? 1 : 0,
      signed_url_expires_at || null,
      retention_expires_at || null,
      access_policy || null
    );
    return { success: true, id };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function listVisionArtifactsBySession(session_id) {
  if (!session_id) return [];
  try {
    return db.db.prepare(`
      SELECT *
      FROM vision_capture_artifacts
      WHERE session_id = ?
      ORDER BY created_at DESC
    `).all(session_id);
  } catch (_) {
    return [];
  }
}

function listVisionEvents(session_id, event_type = null) {
  if (!session_id) return [];
  try {
    if (event_type) {
      return db.db.prepare(`
        SELECT *
        FROM vision_capture_events
        WHERE session_id = ?
          AND event_type = ?
        ORDER BY created_at ASC
      `).all(session_id, event_type);
    }
    return db.db.prepare(`
      SELECT *
      FROM vision_capture_events
      WHERE session_id = ?
      ORDER BY created_at ASC
    `).all(session_id);
  } catch (_) {
    return [];
  }
}

module.exports = {
  ensureVisionCaptureTables,
  insertVisionCaptureEvent,
  claimNextRequestedEvent,
  markVisionEventProcessed,
  upsertChecklistRow,
  getChecklistRow,
  listChecklistBySession,
  getLatestVisionGuidance,
  insertVisionArtifact,
  listVisionArtifactsBySession,
  listVisionEvents
};
