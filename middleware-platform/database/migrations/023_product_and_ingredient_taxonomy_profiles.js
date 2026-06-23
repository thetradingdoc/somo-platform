function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS product_regulatory_profiles (
      product_id TEXT PRIMARY KEY,
      grade_class TEXT NOT NULL,                    -- OTC_DRUG | MEDICAL_RX | PROFESSIONAL | COSMECEUTICAL_MARKETING | GENERAL_COSMETIC
      grade_confidence TEXT NOT NULL DEFAULT 'low', -- low | medium | high
      regulatory_basis_json TEXT,
      drug_facts_present INTEGER DEFAULT 0,
      distribution_channel TEXT,
      source_priority TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_product_reg_profiles_grade ON product_regulatory_profiles(grade_class);

    CREATE TABLE IF NOT EXISTS barcode_lookup_events (
      id TEXT PRIMARY KEY,
      barcode TEXT NOT NULL,
      source TEXT NOT NULL,
      hit INTEGER NOT NULL DEFAULT 0,
      product_id TEXT,
      grade_class TEXT,
      confidence TEXT,
      details_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_barcode_lookup_events_barcode ON barcode_lookup_events(barcode, created_at DESC);

    CREATE TABLE IF NOT EXISTS ingredient_biochem (
      inci_name TEXT PRIMARY KEY,
      derivative_of TEXT,
      molecular_class TEXT,
      pathways_json TEXT,
      concentration_bands_json TEXT,
      ph_dependency TEXT,
      evidence_level TEXT DEFAULT 'low',
      pubchem_cid TEXT,
      metadata_json TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_ingredient_biochem_derivative ON ingredient_biochem(derivative_of);
  `);
}

function down() {
  // no-op for safety
}

module.exports = { up, down };
