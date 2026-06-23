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
  for (const table of ['case_records', 'session_state_projection']) {
    const exists = db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(table);
    if (!exists) continue;
    addColumnIfMissing(db, table, 'clinic_id', 'clinic_id TEXT');
    addColumnIfMissing(db, table, 'customer_id', 'customer_id TEXT');
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_${table}_clinic_id ON ${table}(clinic_id);
    `);
  }
}

function down() {}

module.exports = { up, down };
