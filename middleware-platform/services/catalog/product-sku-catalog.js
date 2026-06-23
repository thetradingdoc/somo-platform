'use strict';

/**
 * B1/B2 — Resolve SKUs and upsert catalog rows for ingestion pipelines.
 */

function _safeJson(str, fallback) {
  if (str == null || str === '') return fallback;
  try {
    return JSON.parse(str);
  } catch (_) {
    return fallback;
  }
}

function createProductSkuCatalog(db) {
  if (!db) {
    return {
      resolveSkusByProductIds: () => [],
      listSkusByProductIds: () => [],
      upsertRow: () => {},
      upsertBatch: () => 0,
    };
  }

  let hasTable = false;
  try {
    const row = db
      .prepare(
        "SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name='product_sku_catalog' LIMIT 1"
      )
      .get();
    hasTable = Boolean(row && row.ok);
  } catch (_) {
    hasTable = false;
  }

  const stmtSkusForProduct = hasTable
    ? db.prepare('SELECT sku FROM product_sku_catalog WHERE product_id = ?')
    : null;
  const stmtUpsert = hasTable
    ? db.prepare(`
        INSERT INTO product_sku_catalog
          (sku, product_id, gtin, brand, display_name, formulation_tags, source, updated_at)
        VALUES (@sku, @product_id, @gtin, @brand, @display_name, @formulation_tags, @source, CURRENT_TIMESTAMP)
        ON CONFLICT(sku) DO UPDATE SET
          product_id = excluded.product_id,
          gtin = COALESCE(excluded.gtin, product_sku_catalog.gtin),
          brand = COALESCE(excluded.brand, product_sku_catalog.brand),
          display_name = COALESCE(excluded.display_name, product_sku_catalog.display_name),
          formulation_tags = excluded.formulation_tags,
          source = excluded.source,
          updated_at = CURRENT_TIMESTAMP
      `)
    : null;

  function listSkusByProductIds(productIds) {
    if (!stmtSkusForProduct || !Array.isArray(productIds) || !productIds.length) return [];
    const out = [];
    const seen = new Set();
    for (const pid of productIds) {
      const id = String(pid || '').trim();
      if (!id) continue;
      for (const r of stmtSkusForProduct.all(id)) {
        if (r && r.sku && !seen.has(r.sku)) {
          seen.add(r.sku);
          out.push(r.sku);
        }
      }
    }
    return out;
  }

  function resolveSkusByProductIds(productIds) {
    return listSkusByProductIds(productIds);
  }

  function upsertRow(row) {
    if (!stmtUpsert || !row || !row.sku || !row.product_id) return;
    const tags = Array.isArray(row.formulation_tags)
      ? JSON.stringify(row.formulation_tags)
      : String(row.formulation_tags || '[]');
    stmtUpsert.run({
      sku: String(row.sku).trim(),
      product_id: String(row.product_id).trim(),
      gtin: row.gtin != null ? String(row.gtin) : null,
      brand: row.brand != null ? String(row.brand) : null,
      display_name: row.display_name != null ? String(row.display_name) : null,
      formulation_tags: tags,
      source: row.source != null ? String(row.source) : 'import',
    });
  }

  function upsertBatch(rows) {
    if (!stmtUpsert || !Array.isArray(rows)) return 0;
    let n = 0;
    const run = db.transaction((list) => {
      for (const row of list) {
        if (!row || !row.sku || !row.product_id) continue;
        upsertRow(row);
        n++;
      }
    });
    run(rows);
    return n;
  }

  function getBySku(sku) {
    if (!hasTable || !sku) return null;
    try {
      return db.prepare('SELECT * FROM product_sku_catalog WHERE sku = ?').get(String(sku));
    } catch (_) {
      return null;
    }
  }

  function formulationTagsForSku(sku) {
    const r = getBySku(sku);
    if (!r) return [];
    return _safeJson(r.formulation_tags, []);
  }

  return {
    resolveSkusByProductIds,
    listSkusByProductIds,
    upsertRow,
    upsertBatch,
    getBySku,
    formulationTagsForSku,
    hasTable,
  };
}

module.exports = { createProductSkuCatalog };
