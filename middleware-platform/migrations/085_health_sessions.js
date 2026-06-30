'use strict';

function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS health_sessions (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL UNIQUE,
      session_status TEXT NOT NULL DEFAULT 'active',
      locale TEXT DEFAULT 'en',
      reply_language TEXT DEFAULT 'en',
      terms_accepted_at DATETIME,
      report_json TEXT,
      metadata_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      ended_at DATETIME
    );
    CREATE INDEX IF NOT EXISTS idx_health_sessions_room ON health_sessions(room_id);
    CREATE INDEX IF NOT EXISTS idx_health_sessions_status ON health_sessions(session_status, created_at DESC);
  `);
}

function down() {}

module.exports = { up, down };
