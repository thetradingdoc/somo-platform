'use strict';

/**
 * Auditing columns for curated ingredient_aliases (write path + gap reports).
 */
function up(db) {
  const cols = db.prepare('PRAGMA table_info(ingredient_aliases)').all().map((c) => c.name);
  if (!cols.includes('source')) {
    db.exec(`ALTER TABLE ingredient_aliases ADD COLUMN source TEXT DEFAULT 'manual'`);
  }
  if (!cols.includes('updated_at')) {
    db.exec(`ALTER TABLE ingredient_aliases ADD COLUMN updated_at DATETIME`);
  }
}

function down() {}

module.exports = { up, down };
