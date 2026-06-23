'use strict';

/**
 * Phase 0 §3 — Payments edge-case operations:
 * - Refund workflow audit trail
 * - Stripe dispute / chargeback intake
 * - Settlement retry scheduling + dead-letter queue
 * - Named DRI / backup for payment exception queue (persisted; env overrides at runtime)
 */

function addColumnIfMissing(db, table, colDef) {
  try {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all();
    const name = colDef.split(/\s+/)[0];
    if (!cols.some((c) => c.name === name)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${colDef};`);
    }
  } catch (_) {
    /* table may not exist in minimal test DBs */
  }
}

function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS payment_refund_audit (
      id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL,
      checkout_id TEXT,
      payment_intent_id TEXT,
      actor_type TEXT,
      actor_id TEXT,
      refund_kind TEXT,
      amount_requested REAL,
      amount_refunded REAL,
      eligibility_json TEXT,
      stripe_refund_id TEXT,
      status TEXT NOT NULL,
      error_message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_payment_refund_audit_checkout
      ON payment_refund_audit(checkout_id);
    CREATE INDEX IF NOT EXISTS idx_payment_refund_audit_pi
      ON payment_refund_audit(payment_intent_id);
    CREATE INDEX IF NOT EXISTS idx_payment_refund_audit_workflow
      ON payment_refund_audit(workflow_id);

    CREATE TABLE IF NOT EXISTS payment_disputes (
      id TEXT PRIMARY KEY,
      stripe_dispute_id TEXT NOT NULL UNIQUE,
      charge_id TEXT,
      payment_intent_id TEXT,
      amount REAL NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'USD',
      stripe_status TEXT,
      workflow_status TEXT NOT NULL DEFAULT 'open',
      owner TEXT,
      backup_owner TEXT,
      evidence_due_at DATETIME,
      metadata TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_payment_disputes_pi
      ON payment_disputes(payment_intent_id);
    CREATE INDEX IF NOT EXISTS idx_payment_disputes_workflow
      ON payment_disputes(workflow_status);

    CREATE TABLE IF NOT EXISTS settlement_dead_letter_queue (
      id TEXT PRIMARY KEY,
      claim_id TEXT NOT NULL,
      settlement_attempt_id TEXT,
      reason TEXT,
      error_summary TEXT,
      metadata TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_settlement_dlq_claim
      ON settlement_dead_letter_queue(claim_id);

    CREATE TABLE IF NOT EXISTS payment_exception_queue_roles (
      id TEXT PRIMARY KEY,
      dri TEXT,
      backup TEXT,
      owner_pool TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  try {
    db.prepare(`
      INSERT OR IGNORE INTO payment_exception_queue_roles (id, dri, backup)
      VALUES ('default', NULL, NULL)
    `).run();
  } catch (_) {}

  addColumnIfMissing(db, 'settlement_attempts', 'next_settlement_retry_at DATETIME');
  addColumnIfMissing(db, 'settlement_attempts', 'dead_letter_at DATETIME');
}

module.exports = { up };
