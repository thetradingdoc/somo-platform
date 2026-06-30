'use strict';

/**
 * Audit trail for active voice call admissions (reconcile with Redis counters).
 */

function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS voice_active_call_audit (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL,
      call_id TEXT NOT NULL,
      twilio_call_sid TEXT,
      started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      ended_at DATETIME,
      FOREIGN KEY (customer_id) REFERENCES customers(id)
    );
    CREATE INDEX IF NOT EXISTS idx_voice_active_audit_customer
      ON voice_active_call_audit(customer_id, ended_at);
    CREATE INDEX IF NOT EXISTS idx_voice_active_audit_call
      ON voice_active_call_audit(call_id);
  `);
}

function down() {}

module.exports = { up, down };
