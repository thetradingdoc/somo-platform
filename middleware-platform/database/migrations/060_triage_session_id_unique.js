'use strict';

/**
 * CR-024 — dedupe triage_sessions.session_id and add unique index.
 */

function up(db) {
  try {
    const dups = db
      .prepare(
        `SELECT session_id FROM triage_sessions
         WHERE session_id IS NOT NULL AND session_id != ''
         GROUP BY session_id HAVING COUNT(*) > 1`
      )
      .all();
    for (const { session_id: sid } of dups) {
      const rows = db
        .prepare(
          `SELECT id FROM triage_sessions WHERE session_id = ? ORDER BY datetime(created_at) ASC`
        )
        .all(sid);
      const del = db.prepare(`DELETE FROM triage_sessions WHERE id = ?`);
      for (let i = 1; i < rows.length; i++) {
        del.run(rows[i].id);
      }
    }
    db.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_triage_sessions_session_id_unique ON triage_sessions(session_id) WHERE session_id IS NOT NULL AND session_id != ''`
    );
  } catch (e) {
    console.warn('[migration 060] triage_session_id unique index skipped:', e.message);
  }
}

function down(db) {}

module.exports = { up, down };
