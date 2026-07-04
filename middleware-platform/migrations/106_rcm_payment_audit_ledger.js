'use strict';

/**
 * Minimal money audit ledger — session → 271 → quote → PI → settlement (P2-017-018 stub).
 * Full writers land in services/rcm-payment-audit-ledger.js.
 */
function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS rcm_payment_audit_ledger (
      id TEXT PRIMARY KEY,
      clinic_id TEXT,
      session_id TEXT,
      call_id TEXT,
      stage TEXT NOT NULL,
      external_ref_type TEXT,
      external_ref_id TEXT,
      amount_cents INTEGER,
      currency TEXT NOT NULL DEFAULT 'USD',
      status TEXT NOT NULL DEFAULT 'pending',
      details_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_rcm_payment_audit_session
      ON rcm_payment_audit_ledger(session_id);
    CREATE INDEX IF NOT EXISTS idx_rcm_payment_audit_clinic_created
      ON rcm_payment_audit_ledger(clinic_id, created_at);
  `);
}

function down(db) {
  db.exec('DROP TABLE IF EXISTS rcm_payment_audit_ledger');
}

module.exports = { up, down };
