'use strict';

/**
 * X2 — Catalog / reasoning coverage metrics (safe against missing migrations).
 * @param {import('better-sqlite3').Database} [db]
 */
function getCatalogCoverageMetrics(db) {
  const conn =
    db && typeof db.prepare === 'function' ? db : require('../database').db;

  function tableExists(name) {
    try {
      const r = conn
        .prepare(
          "SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name=? LIMIT 1"
        )
        .get(name);
      return !!r;
    } catch (_) {
      return false;
    }
  }

  function safeCount(table) {
    if (!tableExists(table)) return { available: false, count: 0 };
    try {
      const r = conn.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get();
      return { available: true, count: Number(r?.n || 0) };
    } catch (e) {
      return { available: false, count: 0, error: e.message };
    }
  }

  const out = {
    generated_at: new Date().toISOString(),
    products: { available: false, total: 0 },
    product_sku_catalog: { available: false, rows: 0, distinct_product_ids: 0 },
    products_with_catalog_sku: { available: false, count: 0, sku_coverage_pct: 0 },
    knowledge_chunks: {
      available: false,
      rows: 0,
      with_pair_key: 0,
      with_product_id: 0,
      with_sku: 0,
    },
    ingredient_rag_chunks: { available: false, rows: 0 },
    ingredient_interactions: { available: false, rows: 0 },
    reasoning_pair_coverage: {
      available: false,
      unique_conflict_pairs_in_graph: 0,
      pairs_with_knowledge_chunk: 0,
      coverage_pct: 0,
    },
  };

  if (tableExists('products')) {
    try {
      const r = conn.prepare('SELECT COUNT(*) AS n FROM products').get();
      out.products = { available: true, total: Number(r?.n || 0) };
    } catch (e) {
      out.products = { available: false, total: 0, error: e.message };
    }
  }

  if (tableExists('product_sku_catalog')) {
    try {
      const rows = conn.prepare('SELECT COUNT(*) AS n FROM product_sku_catalog').get();
      const dist = conn
        .prepare('SELECT COUNT(DISTINCT product_id) AS n FROM product_sku_catalog WHERE product_id IS NOT NULL')
        .get();
      out.product_sku_catalog = {
        available: true,
        rows: Number(rows?.n || 0),
        distinct_product_ids: Number(dist?.n || 0),
      };
    } catch (e) {
      out.product_sku_catalog = { available: false, rows: 0, distinct_product_ids: 0, error: e.message };
    }
  }

  if (out.products.available && out.product_sku_catalog.available) {
    try {
      const r = conn
        .prepare(
          `
        SELECT COUNT(DISTINCT p.id) AS n
        FROM products p
        INNER JOIN product_sku_catalog s ON s.product_id = p.id
      `
        )
        .get();
      const withSku = Number(r?.n || 0);
      const total = out.products.total || 0;
      out.products_with_catalog_sku = {
        available: true,
        count: withSku,
        sku_coverage_pct: total ? Math.round((10000 * withSku) / total) / 100 : 0,
      };
    } catch (e) {
      out.products_with_catalog_sku = { available: false, count: 0, sku_coverage_pct: 0, error: e.message };
    }
  }

  if (tableExists('knowledge_chunks')) {
    try {
      const total = conn.prepare('SELECT COUNT(*) AS n FROM knowledge_chunks').get();
      const pk = conn
        .prepare('SELECT COUNT(*) AS n FROM knowledge_chunks WHERE pair_key IS NOT NULL AND trim(pair_key) != \'\'')
        .get();
      let withPid = { n: 0 };
      let withSku = { n: 0 };
      const cols = conn.prepare('PRAGMA table_info(knowledge_chunks)').all();
      const names = new Set(cols.map((c) => c.name));
      if (names.has('product_id')) {
        withPid = conn
          .prepare('SELECT COUNT(*) AS n FROM knowledge_chunks WHERE product_id IS NOT NULL AND trim(product_id) != \'\'')
          .get();
      }
      if (names.has('sku')) {
        withSku = conn
          .prepare('SELECT COUNT(*) AS n FROM knowledge_chunks WHERE sku IS NOT NULL AND trim(sku) != \'\'')
          .get();
      }
      out.knowledge_chunks = {
        available: true,
        rows: Number(total?.n || 0),
        with_pair_key: Number(pk?.n || 0),
        with_product_id: Number(withPid?.n || 0),
        with_sku: Number(withSku?.n || 0),
      };
    } catch (e) {
      out.knowledge_chunks = {
        available: false,
        rows: 0,
        with_pair_key: 0,
        with_product_id: 0,
        with_sku: 0,
        error: e.message,
      };
    }
  }

  const rag = safeCount('ingredient_rag_chunks');
  out.ingredient_rag_chunks = { available: rag.available, rows: rag.count, ...(rag.error ? { error: rag.error } : {}) };

  const inter = safeCount('ingredient_interactions');
  out.ingredient_interactions = {
    available: inter.available,
    rows: inter.count,
    ...(inter.error ? { error: inter.error } : {}),
  };

  if (tableExists('ingredient_interactions') && tableExists('knowledge_chunks')) {
    try {
      function pairKeyCosing(na, nb) {
        const a = String(na || '')
          .replace(/^cosing:/i, '')
          .trim()
          .toLowerCase();
        const b = String(nb || '')
          .replace(/^cosing:/i, '')
          .trim()
          .toLowerCase();
        if (!a || !b) return null;
        const [x, y] = a < b ? [a, b] : [b, a];
        return `cosing:${x}|cosing:${y}`;
      }

      const interactionRows = conn
        .prepare('SELECT ingredient_a, ingredient_b FROM ingredient_interactions')
        .all();
      const chunkRows = conn
        .prepare('SELECT pair_key FROM knowledge_chunks WHERE pair_key IS NOT NULL')
        .all();
      const chunkKeys = new Set(chunkRows.map((r) => r.pair_key));

      const graphPairs = new Set();
      for (const r of interactionRows) {
        const pk = pairKeyCosing(r.ingredient_a, r.ingredient_b);
        if (pk) graphPairs.add(pk);
      }

      let withChunk = 0;
      for (const pk of graphPairs) {
        if (chunkKeys.has(pk)) withChunk++;
      }

      const n = graphPairs.size;
      out.reasoning_pair_coverage = {
        available: true,
        unique_conflict_pairs_in_graph: n,
        pairs_with_knowledge_chunk: withChunk,
        coverage_pct: n ? Math.round((10000 * withChunk) / n) / 100 : 0,
      };
    } catch (e) {
      out.reasoning_pair_coverage = {
        available: false,
        unique_conflict_pairs_in_graph: 0,
        pairs_with_knowledge_chunk: 0,
        coverage_pct: 0,
        error: e.message,
      };
    }
  }

  return out;
}

module.exports = { getCatalogCoverageMetrics };
