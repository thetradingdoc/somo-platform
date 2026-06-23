/**
 * Stage 3 (W2-S3.5): Add differentials column to triage_rag_results.
 * Persists JSON array of differential objects from _generateDifferentials.
 */

function up(db) {
  try {
    const info = db.prepare('PRAGMA table_info(triage_rag_results)').all();
    if (!info.some(c => c.name === 'differentials')) {
      db.exec('ALTER TABLE triage_rag_results ADD COLUMN differentials TEXT DEFAULT \'[]\'');
    }
  } catch (e) {
    console.warn('[012] differentials column:', e.message);
  }
}

function down(db) {
  // SQLite doesn't support DROP COLUMN easily
}

module.exports = { up, down };
