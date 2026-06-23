'use strict';

/**
 * B1/B2 — Optional SKU / product linkage on knowledge_chunks for future SKU-scoped RAG.
 * Nullable columns; existing rows unchanged. Retriever treats null as global chunk.
 */
function up(db) {
  let cols = [];
  try {
    cols = db.prepare('PRAGMA table_info(knowledge_chunks)').all().map((c) => c.name);
  } catch (_) {
    return;
  }
  if (!cols.includes('sku')) {
    db.exec('ALTER TABLE knowledge_chunks ADD COLUMN sku TEXT');
  }
  if (!cols.includes('product_id')) {
    db.exec('ALTER TABLE knowledge_chunks ADD COLUMN product_id TEXT');
  }
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_product_id
      ON knowledge_chunks(product_id) WHERE product_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_sku
      ON knowledge_chunks(sku) WHERE sku IS NOT NULL;
  `);
}

function down(db) {
  /* SQLite: column drop not supported in older versions — leave columns */
}

module.exports = { up, down };
