function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS session_result_snapshots (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      schema_version TEXT NOT NULL,
      snapshot_json TEXT NOT NULL,
      source TEXT DEFAULT 'assembler_v1',
      is_latest INTEGER NOT NULL DEFAULT 1,
      generated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_session_result_snapshots_session
      ON session_result_snapshots(session_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_session_result_snapshots_latest
      ON session_result_snapshots(session_id, is_latest, created_at DESC);

    CREATE TABLE IF NOT EXISTS session_result_edits (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      snapshot_id TEXT,
      field_path TEXT NOT NULL,
      original_ai_value_json TEXT,
      user_corrected_value_json TEXT,
      reason_for_change TEXT,
      confidence_before REAL,
      confidence_after REAL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_session_result_edits_session
      ON session_result_edits(session_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_session_result_edits_field
      ON session_result_edits(session_id, field_path, created_at DESC);
  `);
}

function down() {
  // no-op for safety
}

module.exports = { up, down };
