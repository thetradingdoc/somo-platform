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
  addColumnIfMissing(db, 'clinics', 'npi', 'npi TEXT');
  addColumnIfMissing(db, 'clinics', 'tax_id', 'tax_id TEXT');
  addColumnIfMissing(db, 'clinics', 'practice_address', 'practice_address TEXT');
  addColumnIfMissing(db, 'clinics', 'payer_list_json', 'payer_list_json TEXT');
  addColumnIfMissing(db, 'clinics', 'shadow_week_active', 'shadow_week_active INTEGER DEFAULT 0');
  addColumnIfMissing(db, 'clinics', 'pilot_live_at', 'pilot_live_at TEXT');

  db.exec(`
    CREATE TABLE IF NOT EXISTS provider_invites (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL,
      practice_name TEXT,
      office_type TEXT DEFAULT 'dental',
      use_case TEXT DEFAULT 'dental',
      lead_id TEXT,
      customer_id TEXT,
      clinic_id TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      expires_at TEXT NOT NULL,
      accepted_at TEXT,
      created_by TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_provider_invites_email ON provider_invites(email);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_provider_invites_status ON provider_invites(status, expires_at);`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS internal_events (
      id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      session_id TEXT,
      clinic_id TEXT,
      customer_id TEXT,
      payload_json TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_internal_events_type ON internal_events(event_type, created_at);`);
}

function down() {}

module.exports = { up, down };
