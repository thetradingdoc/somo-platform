/**
 * gap14: Add soap_note to triage_rag_results for auto-generated SOAP.
 * gap17: Unique constraint on (practitioner_id, start_time) for appointments.
 * gap18: kelly_session_meta for persisted preferred_language.
 */

function up(db) {
  // gap18: lightweight session metadata (language persistence)
  db.exec(`
    CREATE TABLE IF NOT EXISTS kelly_session_meta (
      session_id TEXT PRIMARY KEY,
      preferred_language TEXT DEFAULT 'en',
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // gap14: soap_note column for triage-generated SOAP
  try {
    const info = db.prepare('PRAGMA table_info(triage_rag_results)').all();
    if (!info.some(c => c.name === 'soap_note')) {
      db.exec('ALTER TABLE triage_rag_results ADD COLUMN soap_note TEXT');
    }
  } catch (_) {}
  // gap13: rag_confidence column
  try {
    const info2 = db.prepare('PRAGMA table_info(triage_rag_results)').all();
    if (!info2.some(c => c.name === 'rag_confidence')) {
      db.exec('ALTER TABLE triage_rag_results ADD COLUMN rag_confidence REAL DEFAULT 0.7');
    }
  } catch (_) {}

  // gap17: practitioner-level slot uniqueness (prevents double-booking)
  try {
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_appointments_practitioner_start_unique
      ON appointments(practitioner_id, start_time)
      WHERE practitioner_id IS NOT NULL AND practitioner_id != ''
        AND status NOT IN ('cancelled', 'no_show')
    `);
  } catch (e) {
    console.warn('[010] practitioner unique index:', e.message);
  }
}

function down(db) {
  db.exec('DROP INDEX IF EXISTS idx_appointments_practitioner_start_unique');
  // soap_note column - SQLite doesn't support DROP COLUMN easily, leave it
}

module.exports = { up, down };
