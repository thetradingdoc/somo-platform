/**
 * Phase 1 schema fix:
 * - Add `occupation`
 * - Add `intake_complete_at`
 *
 * Uses ALTER TABLE IF missing so it is safe for environments that already ran 011.
 */

function addColumnIfMissing(db, table, colName, colDef) {
  try {
    const info = db.prepare(`PRAGMA table_info(${table})`).all();
    if (!info.some(c => c.name === colName)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${colName} ${colDef}`);
    }
  } catch (e) {
    console.warn(`[015] Add ${colName} to ${table}:`, e.message);
  }
}

function up(db) {
  addColumnIfMissing(db, 'triage_sessions', 'occupation', 'TEXT');
  // Stored as ISO timestamp string
  addColumnIfMissing(db, 'triage_sessions', 'intake_complete_at', 'TEXT');
}

function down(db) {
  // SQLite doesn't support DROP COLUMN easily.
}

module.exports = { up, down };

