'use strict';

/** 082 — persist coding provenance on triage spine rows */

function up(db) {
  const cols = db.prepare('PRAGMA table_info(triage_rag_results)').all();
  if (!cols.some((c) => c.name === 'coding_provenance_json')) {
    db.exec(`
      ALTER TABLE triage_rag_results ADD COLUMN coding_provenance_json TEXT;
    `);
  }
}

function down() {
  console.warn('[082] down: no-op');
}

module.exports = { up, down };
