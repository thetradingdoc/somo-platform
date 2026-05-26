'use strict';

/**
 * Customer catalog search (Step 3 onboarding) + enrichment helpers.
 */

const customerCatalogSearchMetrics = {
  total: 0,
  success: 0,
  failed: 0,
  no_results: 0,
  fallback_index_unavailable: 0,
  catalog_selected: 0,
  custom_fallback: 0,
  latency_ms_sum: 0,
  top_miss_queries: new Map()
};

function safeParseJsonArray(raw) {
  try {
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function suggestCategoryFromRecord(record = {}) {
  const name = String(record.product_name || record.name || '').toLowerCase();
  const tags = [
    ...safeParseJsonArray(record.categories_tags_json),
    ...safeParseJsonArray(record.categories_hierarchy_json)
  ]
    .map((x) => String(x || '').toLowerCase())
    .join(' ');
  const hay = `${name} ${tags}`;
  if (/retinol|retinal/.test(hay)) return 'retinol';
  if (/sunscreen|spf|sun[-\s]?care/.test(hay)) return 'sunscreen';
  if (/cleanser|face[-\s]?wash|gel[-\s]?cleanser/.test(hay)) return 'cleanser';
  if (/toner|mist/.test(hay)) return 'toner_mist';
  if (/vitamin c|ascorbic/.test(hay)) return 'vitamin_c';
  if (/eye/.test(hay)) return 'eye_cream';
  if (/moistur/.test(hay)) return 'moisturizer';
  if (/serum/.test(hay)) return 'hydrating_serum';
  return 'other';
}

function confidenceForQuery(name = '', brand = '', q = '') {
  const n = String(name || '').toLowerCase();
  const b = String(brand || '').toLowerCase();
  const query = String(q || '').toLowerCase().trim();
  if (!query) return 0.5;
  if (n === query) return 0.98;
  if (n.startsWith(query)) return 0.93;
  if (n.includes(query)) return 0.87;
  if (b && b.includes(query)) return 0.8;
  return 0.62;
}

function dbTableExists(db, name) {
  try {
    const row = db.db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name = ?`).get(name);
    return !!row;
  } catch (_) {
    return false;
  }
}

function normalizeCatalogRows(rows = [], source) {
  return rows
    .map((r) => {
      const productName = String(r.product_name || r.name || '').trim();
      if (!productName) return null;
      const brand = String(r.brand || r.brands || '').trim() || null;
      const barcode = r.code ? String(r.code) : null;
      const defaultCategory = suggestCategoryFromRecord(r);
      return {
        catalog_product_id: `${source}:${barcode || r.id || r.source_product_id || productName.toLowerCase().replace(/\s+/g, '-')}`,
        source,
        barcode,
        name: productName,
        brand,
        image_url: r.image_url || null,
        category_suggestions: [defaultCategory],
        default_category: defaultCategory,
        match_confidence: 0.75,
        is_custom: false
      };
    })
    .filter(Boolean);
}

function tryEnrichCustomStep3Products(sessionId, db) {
  try {
    const pending = db.db.prepare(`
      SELECT id, custom_product_name, custom_brand
      FROM patient_onboarding_step3_products
      WHERE session_id = ? AND selection_mode = 'custom' AND custom_pending_enrichment = 1
    `).all(sessionId);
    if (!pending.length) return { processed: 0, merged: 0 };

    const pickCatalogMatch = (name, brand) => {
      const q = `%${String(name || '').toLowerCase()}%`;
      if (dbTableExists(db, 'products_catalog')) {
        const row = db.db.prepare(`
          SELECT id, product_name, brand
          FROM products_catalog
          WHERE lower(COALESCE(product_name,'')) LIKE ?
          ORDER BY updated_at DESC
          LIMIT 1
        `).get(q);
        if (row?.id) return { catalog_product_id: `catalog:${row.id}` };
      }
      if (dbTableExists(db, 'products_obf_index')) {
        const row = db.db.prepare(`
          SELECT code, product_name, brands
          FROM products_obf_index
          WHERE lower(COALESCE(product_name,'')) LIKE ?
             OR lower(COALESCE(brands,'')) LIKE ?
          ORDER BY updated_at DESC
          LIMIT 1
        `).get(q, `%${String(brand || '').toLowerCase()}%`);
        if (row?.code) return { catalog_product_id: `obf:${row.code}` };
      }
      if (dbTableExists(db, 'products_off_index')) {
        const row = db.db.prepare(`
          SELECT code, product_name, brands
          FROM products_off_index
          WHERE lower(COALESCE(product_name,'')) LIKE ?
             OR lower(COALESCE(brands,'')) LIKE ?
          ORDER BY updated_at DESC
          LIMIT 1
        `).get(q, `%${String(brand || '').toLowerCase()}%`);
        if (row?.code) return { catalog_product_id: `off:${row.code}` };
      }
      return null;
    };

    let merged = 0;
    for (const row of pending) {
      const match = pickCatalogMatch(row.custom_product_name, row.custom_brand);
      if (!match) continue;
      db.db.prepare(`
        UPDATE patient_onboarding_step3_products
        SET selection_mode = 'catalog',
            catalog_product_id = ?,
            custom_pending_enrichment = 0,
            fallback_reason = 'enriched_match',
            updated_at = datetime('now')
        WHERE id = ?
      `).run(match.catalog_product_id, row.id);
      merged += 1;
    }

    const dedupeRows = db.db.prepare(`
      SELECT id, selection_mode, catalog_product_id, custom_product_name, usage_time, goal, updated_at, created_at
      FROM patient_onboarding_step3_products
      WHERE session_id = ?
      ORDER BY datetime(updated_at) DESC, datetime(created_at) DESC
    `).all(sessionId);
    const keep = new Set();
    const remove = [];
    dedupeRows.forEach((r) => {
      const key = `${r.selection_mode}|${r.catalog_product_id || r.custom_product_name || ''}|${r.usage_time || ''}|${r.goal || ''}`;
      if (keep.has(key)) {
        remove.push(r.id);
      } else {
        keep.add(key);
      }
    });
    if (remove.length) {
      const del = db.db.prepare(`DELETE FROM patient_onboarding_step3_products WHERE id = ?`);
      for (const id of remove) del.run(id);
    }

    db.db.prepare(`
      UPDATE patient_onboarding_enrichment_queue
      SET status = CASE WHEN ? > 0 THEN 'merged' ELSE 'no_match' END,
          attempts = attempts + 1,
          updated_at = datetime('now')
      WHERE session_id = ? AND status = 'pending'
    `).run(merged, sessionId);
    return { processed: pending.length, merged };
  } catch (_) {
    return { processed: 0, merged: 0 };
  }
}

function getCustomerCatalogSearchMetrics() {
  return customerCatalogSearchMetrics;
}

function registerCustomerCatalogRoutes(app, { apiLimiter, requirePatientSession, db }) {
  app.get(
    '/api/customer/catalog/search',
    (req, res, next) => apiLimiter(req, res, next),
    requirePatientSession,
    async (req, res) => {
      const started = Date.now();
      customerCatalogSearchMetrics.total += 1;
      try {
        const q = String(req.query?.q || '').trim();
        const limit = Math.max(1, Math.min(20, Number(req.query?.limit) || 8));
        if (q.length < 2) {
          return res.status(400).json({
            success: false,
            error_code: 'INVALID_QUERY',
            message: 'Query must be at least 2 characters.'
          });
        }
        const hasProductsCatalog = dbTableExists(db, 'products_catalog');
        const hasObf = dbTableExists(db, 'products_obf_index');
        const hasOff = dbTableExists(db, 'products_off_index');
        if (!hasProductsCatalog && !hasObf && !hasOff) {
          customerCatalogSearchMetrics.fallback_index_unavailable += 1;
          return res.json({
            success: true,
            query: q,
            results: [],
            fallback: { reason: 'index_unavailable' },
            pagination: { next_cursor: null, has_more: false }
          });
        }

        const queryNorm = `%${q.toLowerCase()}%`;
        let rows = [];
        if (hasProductsCatalog) {
          const catalogRows = db.db.prepare(`
        SELECT id, source, source_product_id, brand, product_name, normalized_name, metadata_json
        FROM products_catalog
        WHERE lower(COALESCE(product_name,'')) LIKE ?
           OR lower(COALESCE(brand,'')) LIKE ?
           OR lower(COALESCE(normalized_name,'')) LIKE ?
        ORDER BY updated_at DESC
        LIMIT ?
      `).all(queryNorm, queryNorm, queryNorm, limit * 2);
          rows = rows.concat(normalizeCatalogRows(catalogRows, 'catalog'));
        }
        if (hasObf) {
          const obfRows = db.db.prepare(`
        SELECT code, product_name, brands, categories_tags_json, categories_hierarchy_json, image_url
        FROM products_obf_index
        WHERE lower(COALESCE(product_name,'')) LIKE ?
           OR lower(COALESCE(brands,'')) LIKE ?
        ORDER BY updated_at DESC
        LIMIT ?
      `).all(queryNorm, queryNorm, limit * 2);
          rows = rows.concat(normalizeCatalogRows(obfRows, 'obf'));
        }
        if (hasOff) {
          const offRows = db.db.prepare(`
        SELECT code, product_name, brands, categories_tags_json, categories_hierarchy_json, image_url
        FROM products_off_index
        WHERE lower(COALESCE(product_name,'')) LIKE ?
           OR lower(COALESCE(brands,'')) LIKE ?
        ORDER BY updated_at DESC
        LIMIT ?
      `).all(queryNorm, queryNorm, limit * 2);
          rows = rows.concat(normalizeCatalogRows(offRows, 'off'));
        }

        const dedup = new Map();
        for (const r of rows) {
          const key = `${String(r.name || '').toLowerCase()}|${String(r.brand || '').toLowerCase()}`;
          if (!dedup.has(key)) dedup.set(key, r);
        }
        const results = Array.from(dedup.values())
          .map((r) => ({
            ...r,
            match_confidence: confidenceForQuery(r.name, r.brand, q)
          }))
          .sort((a, b) => b.match_confidence - a.match_confidence)
          .slice(0, limit);

        if (!results.length) {
          customerCatalogSearchMetrics.no_results += 1;
          const k = q.toLowerCase();
          customerCatalogSearchMetrics.top_miss_queries.set(
            k,
            (customerCatalogSearchMetrics.top_miss_queries.get(k) || 0) + 1
          );
        }
        customerCatalogSearchMetrics.success += 1;
        customerCatalogSearchMetrics.latency_ms_sum += Date.now() - started;
        return res.json({
          success: true,
          query: q,
          results,
          pagination: { next_cursor: null, has_more: false }
        });
      } catch (e) {
        customerCatalogSearchMetrics.failed += 1;
        customerCatalogSearchMetrics.latency_ms_sum += Date.now() - started;
        return res.status(500).json({ success: false, error_code: 'SERVER_ERROR', message: e.message });
      }
    }
  );

  app.get('/api/customer/catalog/search/metrics', (req, res) => {
    const topMiss = Array.from(customerCatalogSearchMetrics.top_miss_queries.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([query, count]) => ({ query, count }));
    const avgLatency = customerCatalogSearchMetrics.total
      ? Math.round(customerCatalogSearchMetrics.latency_ms_sum / customerCatalogSearchMetrics.total)
      : 0;
    return res.json({
      success: true,
      metrics: {
        ...customerCatalogSearchMetrics,
        top_miss_queries: topMiss,
        avg_latency_ms: avgLatency
      }
    });
  });
}

module.exports = {
  registerCustomerCatalogRoutes,
  tryEnrichCustomStep3Products,
  getCustomerCatalogSearchMetrics
};
