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
  const table = 'kelly_rails_session_projection';
  const exists = db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(table);
  if (!exists) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS kelly_rails_session_projection (
        session_id TEXT PRIMARY KEY,
        active_lane TEXT,
        step TEXT,
        flags_json TEXT,
        appointment_id TEXT,
        clinic_id TEXT,
        customer_id TEXT,
        runtime TEXT DEFAULT 'kelly_rails_v2',
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
  }
  addColumnIfMissing(db, table, 'clinic_id', 'clinic_id TEXT');
  addColumnIfMissing(db, table, 'customer_id', 'customer_id TEXT');
  const stillExists = db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(table);
  if (!stillExists) return;
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_kelly_rails_proj_clinic_updated
      ON kelly_rails_session_projection(clinic_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_kelly_rails_proj_customer
      ON kelly_rails_session_projection(customer_id);
  `);
}

function down() {}

module.exports = { up, down };
