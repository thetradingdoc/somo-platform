'use strict';

/**
 * ICD-10-PCS hospital procedure codebook (CMS FY2025).
 */

function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS icd10_pcs_codes (
      code TEXT PRIMARY KEY,
      description TEXT NOT NULL,
      source_file TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_icd10_pcs_codes_description ON icd10_pcs_codes(description);
  `);
}

function down(db) {
  db.exec('DROP TABLE IF EXISTS icd10_pcs_codes');
}

module.exports = { up, down };
