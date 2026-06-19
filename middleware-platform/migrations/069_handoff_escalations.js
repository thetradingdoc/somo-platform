'use strict';

function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS handoff_escalations (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      call_id TEXT,
      reason TEXT NOT NULL,
      pstn_target TEXT,
      script_played_at DATETIME,
      transfer_attempted_at DATETIME,
      outcome TEXT,
      metadata_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_handoff_escalations_call ON handoff_escalations(call_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_handoff_escalations_session ON handoff_escalations(session_id, created_at DESC);
  `);
}

function down() {}

module.exports = { up, down };
