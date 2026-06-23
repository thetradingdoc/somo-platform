'use strict';

/** 080 — quote_audit for payer quote traceability (Session 4) */

function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS quote_audit (
      id TEXT PRIMARY KEY,
      call_id TEXT,
      session_id TEXT,
      payer_id TEXT,
      plan_id TEXT,
      primary_icd10 TEXT,
      primary_cpt TEXT,
      rule_version TEXT,
      inputs_json TEXT,
      result_json TEXT,
      status TEXT,
      copay_due_now REAL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_quote_audit_call ON quote_audit(call_id);
    CREATE INDEX IF NOT EXISTS idx_quote_audit_session ON quote_audit(session_id);
  `);
}

function down() {
  console.warn('[080] down: no-op');
}

module.exports = { up, down };
