'use strict';

/** 078 — triage_rag_results.primary_cpt for spine → insurance binding (Session 3) */

function addColIfMissing(db, table, colName, colDef) {
  try {
    const info = db.prepare(`PRAGMA table_info(${table})`).all();
    if (!info.some((c) => c.name === colName)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${colName} ${colDef}`);
      console.log(`[078] Added column ${colName} to ${table}`);
    }
  } catch (e) {
    console.warn(`[078] addColIfMissing ${table}.${colName}: ${e.message}`);
  }
}

function up(db) {
  addColIfMissing(db, 'triage_rag_results', 'primary_cpt', 'TEXT');
  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_triage_rag_results_primary_cpt ON triage_rag_results(primary_cpt)`);
  } catch (e) {
    console.warn('[078] index skipped:', e.message);
  }
  try {
    db.exec(`
      UPDATE triage_rag_results
      SET primary_cpt = json_extract(cpt_codes, '$[0].code')
      WHERE (primary_cpt IS NULL OR primary_cpt = '')
        AND cpt_codes IS NOT NULL
        AND cpt_codes != '[]'
        AND json_extract(cpt_codes, '$[0].code') IS NOT NULL
    `);
  } catch (e) {
    console.warn('[078] primary_cpt backfill skipped:', e.message);
  }
}

function down() {
  console.warn('[078] down: no-op');
}

module.exports = { up, down };
