#!/usr/bin/env node
'use strict';
/* eslint-disable no-console */

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { resolveCategoryRoute } = require('../services/catalog/category-route-resolver');

function parseArgs(argv) {
  const out = {
    dbPath: path.join(__dirname, '..', 'middleware-dev.db'),
    output: path.join(__dirname, '..', 'tmp', 'category-route-observability.json'),
    limit: 10000
  };
  for (let i = 2; i < argv.length; i++) {
    const a = String(argv[i] || '');
    if (a === '--db') out.dbPath = String(argv[++i] || out.dbPath);
    else if (a === '--output') out.output = String(argv[++i] || out.output);
    else if (a === '--limit') out.limit = Math.max(1, Number(argv[++i] || out.limit) || out.limit);
  }
  return out;
}

function parseJsonArray(v) {
  try {
    const p = JSON.parse(String(v || '[]'));
    return Array.isArray(p) ? p : [];
  } catch (_) {
    return [];
  }
}

function increment(obj, key) {
  obj[key] = (obj[key] || 0) + 1;
}

function scanTable(db, table, source, limit, agg, topTagsUnknown) {
  const rows = db
    .prepare(
      `SELECT code, product_name, brands, categories_tags_json, categories_hierarchy_json, ingredients_text
       FROM ${table}
       ORDER BY updated_at DESC
       LIMIT ?`
    )
    .all(limit);
  for (const r of rows) {
    const tags = parseJsonArray(r.categories_tags_json);
    const hierarchy = parseJsonArray(r.categories_hierarchy_json);
    const brands = String(r.brands || '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
    const out = resolveCategoryRoute({
      source,
      categories_tags: tags,
      categories_hierarchy: hierarchy,
      product_name: r.product_name || '',
      brands,
      ingredients_text: r.ingredients_text || ''
    });
    agg.total += 1;
    increment(agg.byRoute, out.route);
    increment(agg.byResolverSource, out.source);
    increment(agg.byCatalogSource, source);
    if (out.route === 'unknown') {
      agg.unknown += 1;
      for (const t of tags.slice(0, 8)) increment(topTagsUnknown, String(t || '').toLowerCase());
    }
  }
}

function main() {
  const args = parseArgs(process.argv);
  const db = new Database(args.dbPath, { readonly: true, fileMustExist: true });
  const agg = {
    generated_at: new Date().toISOString(),
    total: 0,
    unknown: 0,
    unknown_rate: 0,
    byRoute: {},
    byResolverSource: {},
    byCatalogSource: {}
  };
  const topTagsUnknown = {};
  scanTable(db, 'products_obf_index', 'open_beauty_facts', args.limit, agg, topTagsUnknown);
  scanTable(db, 'products_off_index', 'open_food_facts', args.limit, agg, topTagsUnknown);
  db.close();
  agg.unknown_rate = agg.total > 0 ? Number((agg.unknown / agg.total).toFixed(6)) : 0;
  agg.top_unknown_tags = Object.entries(topTagsUnknown)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 50)
    .map(([tag, count]) => ({ tag, count }));

  fs.mkdirSync(path.dirname(args.output), { recursive: true });
  fs.writeFileSync(args.output, `${JSON.stringify(agg, null, 2)}\n`, 'utf8');
  console.log(`[category-route-observability] wrote ${args.output}`);
  console.log(JSON.stringify({
    total: agg.total,
    unknown: agg.unknown,
    unknown_rate: agg.unknown_rate,
    byRoute: agg.byRoute
  }, null, 2));
}

main();
