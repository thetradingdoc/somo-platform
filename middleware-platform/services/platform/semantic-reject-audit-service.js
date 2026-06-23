'use strict';

const crypto = require('crypto');
const dbModule = require('../../database');

function _safeStringify(v) {
  try {
    return JSON.stringify(v == null ? null : v);
  } catch (_) {
    return JSON.stringify(String(v || ''));
  }
}

function logSemanticReject({
  sessionId = null,
  route = 'unknown',
  field = 'unknown',
  rejectedValue = null,
  contractVersion = null,
  reason = 'semantic_reject'
} = {}) {
  try {
    const db = dbModule.db;
    if (!db) return null;
    const hash = crypto.createHash('sha1').update(String(_safeStringify(rejectedValue))).digest('hex');
    const id = crypto.randomUUID();
    db.prepare(`
      INSERT INTO semantic_reject_audit_log
      (id, session_id, route, field_path, rejected_value_hash, contract_version, reject_reason, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).run(
      id,
      sessionId ? String(sessionId) : null,
      String(route || 'unknown'),
      String(field || 'unknown'),
      hash,
      contractVersion ? String(contractVersion) : null,
      String(reason || 'semantic_reject')
    );
    return id;
  } catch (_) {
    return null;
  }
}

function listSemanticRejects({ limit = 200, sessionId = null } = {}) {
  const db = dbModule.db;
  if (!db) return [];
  const lim = Math.max(1, Math.min(1000, Number(limit || 200)));
  if (sessionId) {
    return db.prepare(`
      SELECT id, session_id, route, field_path, rejected_value_hash, contract_version, reject_reason, created_at
      FROM semantic_reject_audit_log
      WHERE session_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(String(sessionId), lim);
  }
  return db.prepare(`
    SELECT id, session_id, route, field_path, rejected_value_hash, contract_version, reject_reason, created_at
    FROM semantic_reject_audit_log
    ORDER BY created_at DESC
    LIMIT ?
  `).all(lim);
}

module.exports = {
  logSemanticReject,
  listSemanticRejects
};
