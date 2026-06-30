'use strict';

function up(db) {
  db.exec(`
    ALTER TABLE health_sessions ADD COLUMN terms_version TEXT DEFAULT '2026-06-25';
    ALTER TABLE health_sessions ADD COLUMN session_token TEXT;
    ALTER TABLE health_sessions ADD COLUMN sse_token TEXT;
    ALTER TABLE health_sessions ADD COLUMN sse_token_expires_at DATETIME;

    CREATE TABLE IF NOT EXISTS health_session_transcripts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      room_id TEXT NOT NULL,
      speaker TEXT NOT NULL,
      text TEXT NOT NULL,
      text_original TEXT,
      text_translated TEXT,
      source TEXT,
      ts DATETIME NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (session_id) REFERENCES health_sessions(id)
    );
    CREATE INDEX IF NOT EXISTS idx_health_transcripts_session ON health_session_transcripts(session_id, ts);

    CREATE TABLE IF NOT EXISTS health_session_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL UNIQUE,
      report_json TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (session_id) REFERENCES health_sessions(id)
    );
    CREATE INDEX IF NOT EXISTS idx_health_reports_session ON health_session_reports(session_id);
  `);
}

function down() {}

module.exports = { up, down };
