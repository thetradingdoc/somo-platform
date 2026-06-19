'use strict';

function addColumnIfMissing(db, table, col, ddl) {
  const exists = db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(table);
  if (!exists) return;
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === col)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}

function up(db) {
  addColumnIfMissing(db, 'triage_sessions', 'clinic_id', 'clinic_id TEXT');
  addColumnIfMissing(db, 'triage_sessions', 'customer_id', 'customer_id TEXT');
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_triage_sessions_clinic_session
      ON triage_sessions(clinic_id, session_id);
    CREATE INDEX IF NOT EXISTS idx_triage_sessions_customer
      ON triage_sessions(customer_id);
  `);
}

function down() {}

module.exports = { up, down };
