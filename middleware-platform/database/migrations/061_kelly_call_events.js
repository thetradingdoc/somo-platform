'use strict';

/**
 * REL-04 — Formal kelly_call_events table (no runtime CREATE TABLE).
 */

function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS kelly_call_events (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      call_id TEXT,
      event_type TEXT NOT NULL,
      payload_json TEXT,
      clinic_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const cols = db.prepare('PRAGMA table_info(kelly_call_events)').all();
  const names = new Set(cols.map((c) => c.name));
  if (!names.has('customer_id')) {
    db.exec('ALTER TABLE kelly_call_events ADD COLUMN customer_id TEXT');
  }
  if (!names.has('clinic_id')) {
    db.exec('ALTER TABLE kelly_call_events ADD COLUMN clinic_id TEXT');
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_kelly_call_events_session_created
      ON kelly_call_events(session_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_kelly_call_events_type_created
      ON kelly_call_events(event_type, created_at);
    CREATE INDEX IF NOT EXISTS idx_kelly_call_events_clinic_created
      ON kelly_call_events(clinic_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_kelly_call_events_customer_created
      ON kelly_call_events(customer_id, created_at DESC);
  `);
}

function down() {}

module.exports = { up, down };
