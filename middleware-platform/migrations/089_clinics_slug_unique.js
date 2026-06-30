/**
 * Unique clinic slug where present (P1-6).
 */

function up(db) {
  const row = db.prepare(`
    SELECT name FROM sqlite_master WHERE type='index' AND name='idx_clinics_slug_unique'
  `).get();
  if (!row) {
    try {
      db.exec(`
        CREATE UNIQUE INDEX idx_clinics_slug_unique ON clinics(slug)
        WHERE slug IS NOT NULL AND TRIM(slug) != ''
      `);
    } catch (e) {
      console.warn('[089_clinics_slug_unique] index skipped (duplicates may exist):', e.message);
    }
  }
}

function down(db) {
  db.exec('DROP INDEX IF EXISTS idx_clinics_slug_unique');
}

module.exports = { up, down };
