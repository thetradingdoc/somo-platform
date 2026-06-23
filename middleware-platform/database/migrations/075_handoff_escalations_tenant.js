'use strict';

function addColumnIfMissing(db, table, name, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === name)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}

function up(db) {
  const table = 'handoff_escalations';
  const exists = db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(table);
  if (!exists) return;
  addColumnIfMissing(db, table, 'clinic_id', 'clinic_id TEXT');
  addColumnIfMissing(db, table, 'customer_id', 'customer_id TEXT');
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_handoff_escalations_clinic ON handoff_escalations(clinic_id);
    CREATE INDEX IF NOT EXISTS idx_handoff_escalations_customer ON handoff_escalations(customer_id);
  `);
}

function down() {}

module.exports = { up, down };
