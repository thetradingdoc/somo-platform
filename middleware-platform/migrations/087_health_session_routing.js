'use strict';

function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS health_session_routing (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL UNIQUE,
      eligibility_status TEXT NOT NULL DEFAULT 'pending',
      eligible INTEGER,
      copay_cents INTEGER,
      payer_id TEXT,
      member_id TEXT,
      network_status TEXT,
      urgency TEXT,
      pathway_summary TEXT,
      payment_status TEXT NOT NULL DEFAULT 'none',
      stripe_payment_intent_id TEXT,
      routing_status TEXT NOT NULL DEFAULT 'pending',
      routing_payload_json TEXT,
      paid_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (session_id) REFERENCES health_sessions(id)
    );
    CREATE INDEX IF NOT EXISTS idx_health_session_routing_session ON health_session_routing(session_id);
    CREATE INDEX IF NOT EXISTS idx_health_session_routing_payment ON health_session_routing(payment_status, updated_at DESC);
  `);
}

function down() {}

module.exports = { up, down };
