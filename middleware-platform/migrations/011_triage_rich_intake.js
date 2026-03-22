/**
 * Stage 1: Rich intake columns for triage_sessions
 * W1-S1.1, M-S1.A, M-S6.A
 *
 * Adds: family_history, medications, prior_diagnoses, prior_workups,
 * allergies, alcohol_use, alcohol_cage_score (INTEGER), smoking_status,
 * phq2_score, gad2_score, safety_screen, substance_use, critical_unknowns,
 * soap_note, detected_language, occupation, intake_complete_at
 */

function addColumnIfMissing(db, table, colName, colDef) {
  try {
    const info = db.prepare(`PRAGMA table_info(${table})`).all();
    if (!info.some(c => c.name === colName)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${colName} ${colDef}`);
    }
  } catch (e) {
    console.warn(`[011] Add ${colName} to ${table}:`, e.message);
  }
}

function up(db) {
  const cols = [
    ['family_history', 'TEXT'],
    ['medications', 'TEXT'],
    ['prior_diagnoses', 'TEXT'],
    ['prior_workups', 'TEXT'],
    ['allergies', 'TEXT'],
    ['alcohol_use', 'TEXT'],
    ['alcohol_cage_score', 'INTEGER'],
    ['smoking_status', 'TEXT'],
    ['phq2_score', 'INTEGER'],
    ['gad2_score', 'INTEGER'],
    ['safety_screen', 'TEXT'],
    ['substance_use', 'TEXT'],
    ['critical_unknowns', 'TEXT'],
    ['soap_note', 'TEXT'],
    ['detected_language', 'TEXT'],
    ['occupation', 'TEXT'],
    // Stored as ISO timestamp string
    ['intake_complete_at', 'TEXT']
  ];
  cols.forEach(([name, def]) => addColumnIfMissing(db, 'triage_sessions', name, def));
}

function down(db) {
  // SQLite doesn't support DROP COLUMN easily; leave columns
}

module.exports = { up, down };
