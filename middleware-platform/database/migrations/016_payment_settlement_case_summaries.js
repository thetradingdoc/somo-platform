/**
 * Payment settlement and case summaries:
 * - appointments: payment_status, payment_amount_cents, stripe_payment_intent_id,
 *   circle_transfer_id, payout_status, payout_amount_cents, paid_at, provider_notes,
 *   diagnosis_codes, follow_up_plan
 * - voice_checkouts: stripe_payment_intent_id, stripe_client_secret
 * - practitioners / merchants: circle_wallet_id (via clinics or env)
 * - case_summaries, stripe_webhook_events, payout_events tables
 */

function addColIfMissing(db, table, colName, colDef) {
  try {
    const info = db.prepare(`PRAGMA table_info(${table})`).all();
    if (!info.some(c => c.name === colName)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${colName} ${colDef}`);
    }
  } catch (e) {
    console.warn(`[016] Add ${colName} to ${table}:`, e.message);
  }
}

function up(db) {
  addColIfMissing(db, 'appointments', 'payment_status', "TEXT DEFAULT 'pending'");
  addColIfMissing(db, 'appointments', 'payment_amount_cents', 'INTEGER');
  addColIfMissing(db, 'appointments', 'stripe_payment_intent_id', 'TEXT');
  addColIfMissing(db, 'appointments', 'circle_transfer_id', 'TEXT');
  addColIfMissing(db, 'appointments', 'payout_status', "TEXT DEFAULT 'pending'");
  addColIfMissing(db, 'appointments', 'payout_amount_cents', 'INTEGER');
  addColIfMissing(db, 'appointments', 'paid_at', 'TEXT');
  addColIfMissing(db, 'appointments', 'provider_notes', 'TEXT');
  addColIfMissing(db, 'appointments', 'diagnosis_codes', 'TEXT');
  addColIfMissing(db, 'appointments', 'follow_up_plan', 'TEXT');

  addColIfMissing(db, 'voice_checkouts', 'stripe_payment_intent_id', 'TEXT');
  addColIfMissing(db, 'voice_checkouts', 'stripe_client_secret', 'TEXT');
  addColIfMissing(db, 'voice_checkouts', 'session_id', 'TEXT');

  db.exec(`
    CREATE TABLE IF NOT EXISTS case_summaries (
      appointment_id  TEXT PRIMARY KEY,
      session_id      TEXT,
      practitioner_id TEXT,
      summary_json    TEXT,
      created_at      TEXT DEFAULT (datetime('now'))
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS stripe_webhook_events (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      stripe_event_id  TEXT NOT NULL UNIQUE,
      event_type       TEXT NOT NULL,
      status           TEXT NOT NULL,
      error            TEXT,
      processed_at     TEXT DEFAULT (datetime('now'))
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS payout_events (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      appointment_id      TEXT NOT NULL,
      practitioner_id     TEXT,
      status              TEXT NOT NULL,
      amount_cents        INTEGER,
      circle_transfer_id  TEXT,
      error               TEXT,
      created_at          TEXT DEFAULT (datetime('now'))
    )
  `);

  // clinics may have circle_wallet_id for provider payouts
  addColIfMissing(db, 'clinics', 'circle_wallet_id', 'TEXT');
}

function down(db) {
  console.warn('Migration 016 down: SQLite does not support DROP COLUMN');
}

module.exports = { up, down };
