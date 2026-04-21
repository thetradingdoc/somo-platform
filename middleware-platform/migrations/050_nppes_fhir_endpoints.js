'use strict';

/**
 * NPPES dissemination endpoint_pfile_*.csv — FHIR (and other) endpoints per NPI.
 * Populated by: node scripts/import-nppes-fhir-endpoints.cjs
 */
function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS nppes_fhir_endpoints (
      id TEXT PRIMARY KEY,
      npi TEXT NOT NULL,
      endpoint_type TEXT,
      endpoint_type_description TEXT,
      endpoint_url TEXT NOT NULL,
      affiliation TEXT,
      endpoint_description TEXT,
      affiliation_legal_business_name TEXT,
      use_code TEXT,
      use_description TEXT,
      other_use_description TEXT,
      content_type TEXT,
      content_description TEXT,
      other_content_description TEXT,
      affiliation_address_line_one TEXT,
      affiliation_address_line_two TEXT,
      affiliation_city TEXT,
      affiliation_state TEXT,
      affiliation_country TEXT,
      affiliation_postal_code TEXT,
      source_file TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_nppes_fhir_endpoints_npi ON nppes_fhir_endpoints(npi);
    CREATE INDEX IF NOT EXISTS idx_nppes_fhir_endpoints_content_type ON nppes_fhir_endpoints(content_type);
    CREATE UNIQUE INDEX IF NOT EXISTS uq_nppes_fhir_endpoints_npi_url ON nppes_fhir_endpoints(npi, endpoint_url);
  `);
}

function down(db) {
  db.exec('DROP TABLE IF EXISTS nppes_fhir_endpoints');
}

module.exports = { up, down };
