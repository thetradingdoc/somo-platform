'use strict';

/**
 * 019 — ehr_sync_jobs idempotency + dead-letter support
 */

function addColIfMissing(db, table, colName, colDef) {
  try {
    const info = db.prepare(`PRAGMA table_info(${table})`).all();
    if (!info.some((c) => c.name === colName)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${colName} ${colDef}`);
      console.log(`[019] Added column ${table}.${colName}`);
    }
  } catch (e) {
    console.warn(`[019] addColIfMissing ${table}.${colName}: ${e.message}`);
  }
}

function up(db) {
  addColIfMissing(db, 'ehr_sync_jobs', 'idempotency_key', 'TEXT');
  addColIfMissing(db, 'ehr_sync_jobs', 'dead_letter_json', 'TEXT');
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_ehr_sync_jobs_idempotency_key
      ON ehr_sync_jobs(idempotency_key)
      WHERE idempotency_key IS NOT NULL;
  `);
}

function down() {}

module.exports = { up, down };

