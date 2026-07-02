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
  addColumnIfMissing(db, 'clinics', 'pms_type', "pms_type TEXT DEFAULT 'somo'");
  addColumnIfMissing(db, 'clinics', 'pms_enabled', 'pms_enabled INTEGER DEFAULT 1');
  addColumnIfMissing(db, 'clinics', 'pms_config', 'pms_config TEXT');
  addColumnIfMissing(db, 'clinics', 'pms_connected_at', 'pms_connected_at TEXT');
  addColumnIfMissing(db, 'clinics', 'pms_last_sync_at', 'pms_last_sync_at TEXT');
  addColumnIfMissing(db, 'clinics', 'pms_last_error', 'pms_last_error TEXT');

  addColumnIfMissing(db, 'appointments', 'pms_source', 'pms_source TEXT');
  addColumnIfMissing(db, 'appointments', 'pms_external_id', 'pms_external_id TEXT');
  addColumnIfMissing(db, 'appointments', 'pms_sync_status', "pms_sync_status TEXT DEFAULT 'pending'");

  db.exec(`
    CREATE TABLE IF NOT EXISTS pms_write_log (
      id TEXT PRIMARY KEY,
      clinic_id TEXT NOT NULL,
      action TEXT NOT NULL,
      resource_type TEXT,
      resource_id TEXT,
      status TEXT NOT NULL,
      error TEXT,
      idempotency_key TEXT,
      payload_json TEXT,
      attempt_count INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_pms_write_log_clinic ON pms_write_log(clinic_id, created_at);`);
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_pms_write_log_idempotency ON pms_write_log(idempotency_key) WHERE idempotency_key IS NOT NULL;`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_pms_write_log_retry ON pms_write_log(status, attempt_count);`);
}

function down() {}

module.exports = { up, down };
