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
  addColumnIfMissing(db, 'kelly_rails_session_projection', 'clinic_id', 'clinic_id TEXT');
  addColumnIfMissing(db, 'kelly_rails_session_projection', 'customer_id', 'customer_id TEXT');
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_kelly_rails_proj_clinic_updated
      ON kelly_rails_session_projection(clinic_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_kelly_rails_proj_customer
      ON kelly_rails_session_projection(customer_id);
  `);
}

function down() {}

module.exports = { up, down };
