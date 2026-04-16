#!/usr/bin/env node
'use strict';
/* eslint-disable no-console */

const path = require('path');
const Database = require('better-sqlite3');
const { resolveCategoryRoute } = require('../services/category-route-resolver');

function parseArgs(argv) {
  const out = { dbPath: path.join(__dirname, '..', 'middleware-dev.db'), limit: 10000 };
  for (let i = 2; i < argv.length; i++) {
    const a = String(argv[i] || '');
    if (a === '--db') out.dbPath = String(argv[++i] || out.dbPath);
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

function main() {
  const args = parseArgs(process.argv);
  const db = new Database(args.dbPath, { readonly: true, fileMustExist: true });
  const rows = db.prepare(`
    SELECT 'open_beauty_facts' AS source, code, product_name, brands, ingredients_text, categories_tags_json, categories_hierarchy_json
    FROM products_obf_index
    UNION ALL
    SELECT 'open_food_facts' AS source, code, product_name, brands, ingredients_text, categories_tags_json, categories_hierarchy_json
    FROM products_off_index
    LIMIT ?
  `).all(args.limit);

  let unknown = 0;
  let unknownMissingBoth = 0;
  let unknownWithIngredients = 0;
  for (const row of rows) {
    const brands = String(row.brands || '').split(',').map((x) => x.trim()).filter(Boolean);
    const out = resolveCategoryRoute({
      source: row.source,
      categories_tags: parseJsonArray(row.categories_tags_json),
      categories_hierarchy: parseJsonArray(row.categories_hierarchy_json),
      product_name: row.product_name || '',
      brands,
      ingredients_text: row.ingredients_text || ''
    });
    if (out.route !== 'unknown') continue;
    unknown += 1;
    const hasName = !!String(row.product_name || '').trim();
    const hasIngredients = !!String(row.ingredients_text || '').trim();
    if (!hasName && !hasIngredients) unknownMissingBoth += 1;
    if (hasIngredients) unknownWithIngredients += 1;
  }
  db.close();
  const result = {
    sample_size: rows.length,
    unknown_total: unknown,
    pct_unknown_missing_both: unknown > 0 ? Number((unknownMissingBoth / unknown).toFixed(6)) : 0,
    pct_unknown_with_ingredients: unknown > 0 ? Number((unknownWithIngredients / unknown).toFixed(6)) : 0
  };
  console.log(JSON.stringify(result, null, 2));
}

main();
