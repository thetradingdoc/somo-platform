'use strict';

/**
 * ADA CDT codebook table (Phase 7.7).
 */

function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS cdt_codes (
      code TEXT PRIMARY KEY,
      description TEXT NOT NULL,
      category TEXT,
      subcategory TEXT,
      billable INTEGER DEFAULT 1,
      source_file TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_cdt_codes_description ON cdt_codes(description);
    CREATE INDEX IF NOT EXISTS idx_cdt_codes_category ON cdt_codes(category);
  `);
}

function down(db) {
  db.exec('DROP TABLE IF EXISTS cdt_codes');
}

module.exports = { up, down };
