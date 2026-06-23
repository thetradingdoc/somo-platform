function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS products_obf_index (
      code TEXT PRIMARY KEY,
      product_name TEXT,
      brands TEXT,
      brands_tags_json TEXT,
      categories_tags_json TEXT,
      categories_hierarchy_json TEXT,
      ingredients_text TEXT,
      ingredients_tags_json TEXT,
      ingredients_analysis_tags_json TEXT,
      states_tags_json TEXT,
      image_url TEXT,
      product_url TEXT,
      source TEXT NOT NULL DEFAULT 'baseline',
      source_file TEXT,
      last_modified_t INTEGER,
      ingested_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_products_obf_index_updated_at ON products_obf_index(updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_products_obf_index_last_modified_t ON products_obf_index(last_modified_t DESC);

    CREATE TABLE IF NOT EXISTS obf_ingestion_runs (
      id TEXT PRIMARY KEY,
      run_type TEXT NOT NULL, -- baseline | delta | replay
      source_file TEXT,
      status TEXT NOT NULL,   -- started | completed | failed
      rows_seen INTEGER DEFAULT 0,
      rows_upserted INTEGER DEFAULT 0,
      rows_failed INTEGER DEFAULT 0,
      notes_json TEXT,
      started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      finished_at DATETIME
    );
    CREATE INDEX IF NOT EXISTS idx_obf_ingestion_runs_type_started ON obf_ingestion_runs(run_type, started_at DESC);

    CREATE TABLE IF NOT EXISTS obf_delta_applied (
      filename TEXT PRIMARY KEY,
      checksum TEXT,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      rows_seen INTEGER DEFAULT 0,
      rows_upserted INTEGER DEFAULT 0,
      rows_failed INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS obf_ingestion_dlq (
      id TEXT PRIMARY KEY,
      source_file TEXT,
      line_number INTEGER,
      code TEXT,
      error TEXT,
      raw_payload TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_obf_ingestion_dlq_created ON obf_ingestion_dlq(created_at DESC);
  `);
}

function down() {
  // no-op for safety
}

module.exports = { up, down };
