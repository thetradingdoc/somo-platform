'use strict';

/** 108 — triage_rag_results: persist HCPCS candidates from dual-source RAG */

function up(db) {
  const cols = db.prepare(`PRAGMA table_info(triage_rag_results)`).all();
  const names = new Set(cols.map((c) => c.name));
  if (!names.has('hcpcs_codes')) {
    db.exec(`ALTER TABLE triage_rag_results ADD COLUMN hcpcs_codes TEXT`);
  }
}

function down(db) {
  // SQLite cannot drop column easily; no-op
}

module.exports = { up, down };
