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
  addColumnIfMissing(db, 'voice_checkouts', 'call_id', 'call_id TEXT');
  addColumnIfMissing(db, 'voice_checkouts', 'appointment_id', 'appointment_id TEXT');
  addColumnIfMissing(db, 'voice_checkouts', 'sms_consent_at', 'sms_consent_at TEXT');
  addColumnIfMissing(db, 'rcm_payments', 'sms_consent_at', 'sms_consent_at TEXT');
  addColumnIfMissing(db, 'rcm_payments', 'payment_receipt_sent_at', 'payment_receipt_sent_at TEXT');

  db.exec(`
    CREATE TABLE IF NOT EXISTS payment_reconciliation_log (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      external_id TEXT,
      checkout_id TEXT,
      appointment_id TEXT,
      call_id TEXT,
      amount_cents INTEGER,
      status TEXT,
      details_json TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_payment_recon_external ON payment_reconciliation_log(source, external_id);`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS eligibility_complete_events (
      id TEXT PRIMARY KEY,
      customer_id TEXT,
      clinic_id TEXT,
      session_id TEXT,
      call_id TEXT,
      payer_id TEXT,
      eligibility_quality TEXT,
      amount_due REAL,
      payload_json TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_elig_complete_session ON eligibility_complete_events(session_id);`);
}

function down() {}

module.exports = { up, down };
