'use strict';

/**
 * Cleaned NPPES-derived providers (only rows that pass import validation).
 * Populated by: node scripts/data/import-nppes-directory.cjs path/to/npidata_pfile_*.csv
 */
function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS nppes_directory_providers (
      npi                     TEXT PRIMARY KEY,
      entity_type_code        TEXT,
      display_name            TEXT NOT NULL,
      credential              TEXT,
      specialty_code          TEXT NOT NULL,
      specialty_display       TEXT,
      address_line_1          TEXT NOT NULL,
      address_line_2          TEXT,
      city                    TEXT NOT NULL,
      state                   TEXT NOT NULL,
      postal_code             TEXT NOT NULL,
      country_code            TEXT,
      phone                   TEXT NOT NULL,
      license_number          TEXT,
      license_state           TEXT,
      source                  TEXT NOT NULL DEFAULT 'nppes',
      raw_row_hash            TEXT,
      imported_at             DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at              DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_nppes_dir_state ON nppes_directory_providers(state);
    CREATE INDEX IF NOT EXISTS idx_nppes_dir_city_state ON nppes_directory_providers(state, city);
    CREATE INDEX IF NOT EXISTS idx_nppes_dir_specialty ON nppes_directory_providers(specialty_code);
    CREATE INDEX IF NOT EXISTS idx_nppes_dir_name ON nppes_directory_providers(display_name);
  `);
}

function down(db) {
  db.exec('DROP TABLE IF EXISTS nppes_directory_providers');
}

module.exports = { up, down };
