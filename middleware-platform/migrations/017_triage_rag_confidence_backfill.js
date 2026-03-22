/**
 * 017 — triage_rag_results: ensure columns + backfill NULL rag_confidence
 *
 * soap_note / rag_confidence are usually added by 010; this migration is idempotent
 * and aligns legacy NULL confidence with executor null→0 gating (Bug 8).
 */

'use strict';

function addColIfMissing(db, table, colName, colDef) {
  try {
    const info = db.prepare(`PRAGMA table_info(${table})`).all();
    if (!info.some((c) => c.name === colName)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${colName} ${colDef}`);
      console.log(`[017] Added column ${colName} to ${table}`);
    }
  } catch (e) {
    console.warn(`[017] addColIfMissing ${table}.${colName}: ${e.message}`);
  }
}

function up(db) {
  addColIfMissing(db, 'triage_rag_results', 'soap_note', 'TEXT');
  addColIfMissing(db, 'triage_rag_results', 'rag_confidence', 'REAL');
  addColIfMissing(db, 'triage_rag_results', 'primary_icd10', 'TEXT');

  try {
    db.exec(`UPDATE triage_rag_results SET rag_confidence = 0.0 WHERE rag_confidence IS NULL`);
    console.log('[017] Back-filled NULL rag_confidence with 0.0');
  } catch (e) {
    console.warn('[017] Back-fill skipped:', e.message);
  }
}

function down() {
  console.warn('[017] down: no-op (SQLite DROP COLUMN not used)');
}

module.exports = { up, down };
