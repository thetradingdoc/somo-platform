'use strict';

/**
 * B3 — Example SKU-scoped monograph row for product-linked retrieval (see retriever productIds filter).
 */
function up(db) {
  let cols = [];
  try {
    cols = db.prepare('PRAGMA table_info(knowledge_chunks)').all().map((c) => c.name);
  } catch (_) {
    return;
  }
  if (!cols.includes('product_id') || !cols.includes('sku')) {
    return;
  }
  try {
    db.prepare(
      `
      INSERT OR IGNORE INTO knowledge_chunks
        (id, ingredient_a, ingredient_b, reason_codes, text, source, evidence_level, product_id, sku)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
    ).run(
      'sku-seed-demo-vitc-mono-001',
      'cosing:ascorbic acid',
      null,
      '["class:antioxidant","sku_scoped"]',
      'B3 seed: SKU-scoped monograph placeholder for this demo vitamin C serum (product-specific formulation notes would live here).',
      'sku_seed',
      'probable',
      'doclittle_demo_vitc_serum',
      'SKU-DEMO-VITC-001',
    );
  } catch (_) {}
  try {
    db.exec(`INSERT INTO knowledge_chunks_fts(knowledge_chunks_fts) VALUES('rebuild')`);
  } catch (_) {}
}

function down(db) {
  try {
    db.prepare('DELETE FROM knowledge_chunks WHERE id = ?').run('sku-seed-demo-vitc-mono-001');
  } catch (_) {}
}

module.exports = { up, down };
