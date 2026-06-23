'use strict';

function addColIfMissing(db, table, colName, colDef) {
  try {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all();
    if (!cols.some((c) => c.name === colName)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${colName} ${colDef}`);
      console.log(`[020] Added ${table}.${colName}`);
    }
  } catch (e) {
    console.warn(`[020] Could not add ${table}.${colName}: ${e.message}`);
  }
}

function up(db) {
  addColIfMissing(db, 'customers', 'password_updated_at', 'DATETIME');

  db.exec(`
    CREATE TABLE IF NOT EXISTS customer_notification_settings (
      customer_id TEXT PRIMARY KEY,
      order_notifications INTEGER DEFAULT 1,
      fraud_alerts INTEGER DEFAULT 1,
      weekly_reports INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (customer_id) REFERENCES customers(id)
    );

    CREATE TABLE IF NOT EXISTS email_change_requests (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL,
      old_email TEXT NOT NULL,
      new_email TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      requested_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      verified_at DATETIME,
      expires_at DATETIME,
      FOREIGN KEY (customer_id) REFERENCES customers(id)
    );
    CREATE INDEX IF NOT EXISTS idx_email_change_requests_customer
      ON email_change_requests(customer_id, status, requested_at);

    CREATE TABLE IF NOT EXISTS customer_profile_audit (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL,
      action TEXT NOT NULL,
      before_json TEXT,
      after_json TEXT,
      actor_ip TEXT,
      actor_user_agent TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (customer_id) REFERENCES customers(id)
    );
    CREATE INDEX IF NOT EXISTS idx_customer_profile_audit_customer
      ON customer_profile_audit(customer_id, created_at);
  `);
}

function down() {}

module.exports = { up, down };

