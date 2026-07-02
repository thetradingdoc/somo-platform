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
  addColumnIfMissing(db, 'eligibility_checks', 'eligibility_quality', 'eligibility_quality TEXT');
  addColumnIfMissing(db, 'monthly_usage', 'eligibility_checks_used', 'eligibility_checks_used INTEGER DEFAULT 0');
  addColumnIfMissing(db, 'monthly_usage', 'overage_eligibility_checks', 'overage_eligibility_checks INTEGER DEFAULT 0');

  db.exec(`
    CREATE TABLE IF NOT EXISTS amount_resolution_log (
      id TEXT PRIMARY KEY,
      patient_id TEXT,
      appointment_id TEXT,
      session_id TEXT,
      quoted_amount REAL,
      charged_amount REAL,
      source TEXT,
      status TEXT,
      details_json TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS eligibility_usage_events (
      id TEXT PRIMARY KEY,
      customer_id TEXT,
      payer_id TEXT,
      session_id TEXT,
      source TEXT,
      quality TEXT,
      event_date TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_elig_usage_customer_date ON eligibility_usage_events(customer_id, event_date);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_amount_resolution_session ON amount_resolution_log(session_id);`);
}

function down() {}

module.exports = { up, down };
