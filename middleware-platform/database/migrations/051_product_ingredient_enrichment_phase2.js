/**
 * Phase 2 products enrichment hardening:
 * - provenance/safety fields on product_ingredients + cosing_ingredients
 * - unresolved token queue for iterative alias expansion
 * - persistent patient product lists (favorites/to_test/custom)
 */
function up(db) {
  const piCols = db.prepare('PRAGMA table_info(product_ingredients)').all().map((c) => c.name);
  if (!piCols.includes('enrichment_version')) {
    db.exec('ALTER TABLE product_ingredients ADD COLUMN enrichment_version TEXT');
  }
  if (!piCols.includes('safety_flags_json')) {
    db.exec('ALTER TABLE product_ingredients ADD COLUMN safety_flags_json TEXT');
  }

  const cosingCols = db.prepare('PRAGMA table_info(cosing_ingredients)').all().map((c) => c.name);
  if (!cosingCols.includes('is_allergen')) {
    db.exec('ALTER TABLE cosing_ingredients ADD COLUMN is_allergen INTEGER DEFAULT 0');
  }
  if (!cosingCols.includes('allergen_type')) {
    db.exec('ALTER TABLE cosing_ingredients ADD COLUMN allergen_type TEXT');
  }
  if (!cosingCols.includes('is_endocrine_dis')) {
    db.exec('ALTER TABLE cosing_ingredients ADD COLUMN is_endocrine_dis INTEGER DEFAULT 0');
  }
  if (!cosingCols.includes('is_eu_restricted')) {
    db.exec('ALTER TABLE cosing_ingredients ADD COLUMN is_eu_restricted INTEGER DEFAULT 0');
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS ingredient_unresolved_queue (
      raw_token TEXT PRIMARY KEY,
      occurrence_count INTEGER DEFAULT 1,
      sample_barcodes_json TEXT,
      first_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      status TEXT DEFAULT 'pending'
    );
    CREATE INDEX IF NOT EXISTS idx_ingredient_unresolved_status_count
      ON ingredient_unresolved_queue(status, occurrence_count DESC, last_seen_at DESC);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS patient_product_lists (
      id TEXT PRIMARY KEY,
      owner_type TEXT NOT NULL,   -- patient | session
      owner_id TEXT NOT NULL,
      list_type TEXT NOT NULL,    -- favorites | to_test | custom
      list_name TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(owner_type, owner_id, list_type, list_name)
    );
    CREATE INDEX IF NOT EXISTS idx_patient_product_lists_owner
      ON patient_product_lists(owner_type, owner_id, updated_at DESC);

    CREATE TABLE IF NOT EXISTS patient_product_list_items (
      id TEXT PRIMARY KEY,
      list_id TEXT NOT NULL,
      product_ref TEXT NOT NULL,  -- obf:<barcode> | off:<barcode> | custom:<id>
      note TEXT,
      concern_tags_json TEXT,
      source_scan_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(list_id, product_ref),
      FOREIGN KEY(list_id) REFERENCES patient_product_lists(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_patient_product_list_items_list
      ON patient_product_list_items(list_id, updated_at DESC);
  `);
}

function down() {}

module.exports = { up, down };
