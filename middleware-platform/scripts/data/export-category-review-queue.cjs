#!/usr/bin/env node
'use strict';
/* eslint-disable no-console */

const path = require('path');
const Database = require('better-sqlite3');
const { resolveCategoryRoute } = require('../../services/catalog/category-route-resolver');

function parseArgs(argv) {
  const out = {
    dbPath: path.join(__dirname, '..', 'middleware-dev.db'),
    output: path.join(__dirname, '..', 'tmp', 'category-review-queue.csv'),
    limit: 5000
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

function csvEscape(v) {
  const s = String(v == null ? '' : v);
  if (!/[,"\n]/.test(s)) return s;
  return `"${s.replace(/"/g, '""')}"`;
}

function pushRows(db, table, source, outRows, limit) {
  const rows = db
    .prepare(
      `SELECT code, product_name, brands, categories_tags_json, categories_hierarchy_json, ingredients_text
       FROM ${table}
       ORDER BY updated_at DESC
       LIMIT ?`
    )
    .all(limit);
  for (const r of rows) {
    const brands = String(r.brands || '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
    const resolved = resolveCategoryRoute({
      source,
      categories_tags: parseJsonArray(r.categories_tags_json),
      categories_hierarchy: parseJsonArray(r.categories_hierarchy_json),
      product_name: r.product_name || '',
      brands,
      ingredients_text: r.ingredients_text || ''
    });
    if (resolved.route === 'unknown' || resolved.confidence_band === 'low' || resolved.review_eligible) {
      outRows.push({
        source,
        code: r.code,
        product_name: r.product_name || '',
        route: resolved.route,
        confidence_band: resolved.confidence_band,
        review_eligible: resolved.review_eligible ? '1' : '0',
        rule_id: resolved.rule_id || '',
        fallback_text: resolved.fallback_text || '',
        top_tags: parseJsonArray(r.categories_tags_json).slice(0, 8).join('|')
      });
    }
  }
}

function main() {
  const args = parseArgs(process.argv);
  const db = new Database(args.dbPath, { readonly: true, fileMustExist: true });
  const outRows = [];
  pushRows(db, 'products_obf_index', 'open_beauty_facts', outRows, args.limit);
  pushRows(db, 'products_off_index', 'open_food_facts', outRows, args.limit);
  db.close();

  const header = [
    'source',
    'code',
    'product_name',
    'route',
    'confidence_band',
    'review_eligible',
    'rule_id',
    'fallback_text',
    'top_tags'
  ];
  const lines = [header.join(',')];
  for (const r of outRows) {
    lines.push(header.map((k) => csvEscape(r[k])).join(','));
  }
  require('fs').mkdirSync(path.dirname(args.output), { recursive: true });
  require('fs').writeFileSync(args.output, `${lines.join('\n')}\n`, 'utf8');
  console.log(`[category-review-queue] wrote ${outRows.length} rows to ${args.output}`);
}

main();
