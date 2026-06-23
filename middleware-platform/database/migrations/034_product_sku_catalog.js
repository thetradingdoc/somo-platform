'use strict';

/**
 * B1/B2 — Canonical SKU metadata for scale ingestion and B3/B4 linkage to knowledge_chunks.
 * knowledge_chunks.product_id / sku reference rows here optionally (soft link via product_id + sku text).
 */
function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS product_sku_catalog (
      sku TEXT PRIMARY KEY,
      product_id TEXT NOT NULL,
      gtin TEXT,
      brand TEXT,
      display_name TEXT,
      formulation_tags TEXT NOT NULL DEFAULT '[]',
      source TEXT NOT NULL DEFAULT 'import',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_product_sku_catalog_product_id
      ON product_sku_catalog(product_id);
    CREATE INDEX IF NOT EXISTS idx_product_sku_catalog_gtin
      ON product_sku_catalog(gtin) WHERE gtin IS NOT NULL;
  `);

  try {
    const cols = db.prepare('PRAGMA table_info(knowledge_chunks)').all().map((c) => c.name);
    if (cols.includes('pair_key') && cols.includes('product_id')) {
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_pair_product
          ON knowledge_chunks(pair_key, product_id) WHERE product_id IS NOT NULL
      `);
    }
  } catch (_) {}
}

function down(db) {
  try {
    db.exec('DROP INDEX IF EXISTS idx_knowledge_chunks_pair_product');
  } catch (_) {}
  try {
    db.exec('DROP TABLE IF EXISTS product_sku_catalog');
  } catch (_) {}
}

module.exports = { up, down };
