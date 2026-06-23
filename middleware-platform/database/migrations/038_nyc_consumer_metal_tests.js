'use strict';

/**
 * NYC Health Department — metal content of consumer products (reference lab tests).
 * Rows are populated via: node scripts/data/import-nyc-metals-csv.cjs path/to.csv
 */
function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS nyc_consumer_metal_tests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_row_id TEXT,
      product_type TEXT,
      product_name TEXT NOT NULL,
      product_name_normalized TEXT NOT NULL,
      metal TEXT NOT NULL,
      concentration_ppm REAL,
      is_not_detected INTEGER NOT NULL DEFAULT 0,
      units TEXT,
      manufacturer TEXT,
      made_in_country TEXT,
      purchase_country TEXT,
      collection_date TEXT,
      investigation_type TEXT,
      dataset_version TEXT NOT NULL DEFAULT 'nyc_unknown',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_nyc_metal_norm ON nyc_consumer_metal_tests(product_name_normalized);
    CREATE INDEX IF NOT EXISTS idx_nyc_metal_metal ON nyc_consumer_metal_tests(metal);
    CREATE INDEX IF NOT EXISTS idx_nyc_metal_type ON nyc_consumer_metal_tests(product_type);
  `);
}

function down(db) {
  db.exec('DROP TABLE IF EXISTS nyc_consumer_metal_tests');
}

module.exports = { up, down };
