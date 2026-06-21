'use strict';

/** 081 — flag harness-seeded triage rows vs live calls */

function up(db) {
  const cols = db.prepare(`PRAGMA table_info(triage_rag_results)`).all();
  if (!cols.some((c) => c.name === 'seeded_for_harness')) {
    db.exec(`
      ALTER TABLE triage_rag_results ADD COLUMN seeded_for_harness INTEGER NOT NULL DEFAULT 0;
      CREATE INDEX IF NOT EXISTS idx_triage_rag_results_seeded ON triage_rag_results(seeded_for_harness);
    `);
  }
}

function down() {
  console.warn('[081] down: no-op');
}

module.exports = { up, down };
