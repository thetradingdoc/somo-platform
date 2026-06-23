'use strict';

function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS semantic_reject_audit_log (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      route TEXT NOT NULL,
      field_path TEXT NOT NULL,
      rejected_value_hash TEXT NOT NULL,
      contract_version TEXT,
      reject_reason TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_semantic_reject_audit_created
      ON semantic_reject_audit_log(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_semantic_reject_audit_session
      ON semantic_reject_audit_log(session_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_semantic_reject_audit_route_field
      ON semantic_reject_audit_log(route, field_path, created_at DESC);
  `);
}

module.exports = { up };
