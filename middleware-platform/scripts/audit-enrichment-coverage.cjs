#!/usr/bin/env node
'use strict';
/* eslint-disable no-console */

const db = require('../database');

function run() {
  const total = Number(
    db.db.prepare(`SELECT COUNT(*) AS n FROM product_ingredients`).get()?.n || 0
  );
  const unresolved = Number(
    db.db.prepare(`
      SELECT COUNT(*) AS n
      FROM product_ingredients
      WHERE match_method = 'unresolved' OR inci_name IS NULL OR trim(inci_name) = ''
    `).get()?.n || 0
  );
  const resolved = Math.max(0, total - unresolved);
  const resolvedPct = total > 0 ? Math.round((resolved / total) * 10000) / 100 : 0;

  const unresolvedTokens = Number(
    db.db.prepare(`SELECT COUNT(*) AS n FROM ingredient_unresolved_queue`).get()?.n || 0
  );
  const topMisses = db.db.prepare(`
    SELECT raw_token, occurrence_count, status, sample_barcodes_json, last_seen_at
    FROM ingredient_unresolved_queue
    ORDER BY occurrence_count DESC, datetime(last_seen_at) DESC
    LIMIT 25
  `).all();

  const byCatalog = db.db.prepare(`
    SELECT
      CASE
        WHEN product_id LIKE 'obf:%' THEN 'obf'
        WHEN product_id LIKE 'off:%' THEN 'off'
        ELSE 'other'
      END AS catalog,
      COUNT(*) AS total_rows,
      SUM(CASE WHEN match_method = 'unresolved' OR inci_name IS NULL OR trim(inci_name) = '' THEN 1 ELSE 0 END) AS unresolved_rows
    FROM product_ingredients
    GROUP BY 1
    ORDER BY total_rows DESC
  `).all().map((r) => {
    const t = Number(r.total_rows || 0);
    const u = Number(r.unresolved_rows || 0);
    return {
      catalog: r.catalog,
      total_rows: t,
      unresolved_rows: u,
      resolved_pct: t > 0 ? Math.round(((t - u) / t) * 10000) / 100 : 0
    };
  });

  console.log(JSON.stringify({
    success: true,
    generated_at: new Date().toISOString(),
    coverage: {
      total_rows: total,
      resolved_rows: resolved,
      unresolved_rows: unresolved,
      resolved_pct: resolvedPct
    },
    unresolved_token_count: unresolvedTokens,
    by_catalog: byCatalog,
    top_unresolved_tokens: topMisses
  }, null, 2));
}

run();
