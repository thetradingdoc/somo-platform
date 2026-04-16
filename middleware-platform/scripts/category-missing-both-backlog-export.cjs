#!/usr/bin/env node
'use strict';
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { resolveCategoryRoute } = require('../services/category-route-resolver');

function parseArgs(argv) {
  const out = {
    dbPath: path.join(__dirname, '..', 'middleware-dev.db'),
    output: path.join(__dirname, '..', 'tmp', 'unknown-missing-both-backlog.csv'),
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

function resolveRowRoute(row, source) {
  const brands = String(row.brands || '').split(',').map((x) => x.trim()).filter(Boolean);
  return resolveCategoryRoute({
    source,
    categories_tags: parseJsonArray(row.categories_tags_json),
    categories_hierarchy: parseJsonArray(row.categories_hierarchy_json),
    product_name: row.product_name || '',
    brands,
    ingredients_text: row.ingredients_text || ''
  });
}

function main() {
  const args = parseArgs(process.argv);
  const db = new Database(args.dbPath, { readonly: true, fileMustExist: true });
  const rows = [];
  const scan = (table, source) => {
    const sql = `SELECT code, product_name, brands, ingredients_text, categories_tags_json, categories_hierarchy_json
      FROM ${table}
      ORDER BY updated_at DESC LIMIT ?`;
    const data = db.prepare(sql).all(args.limit);
    for (const row of data) {
      const route = resolveRowRoute(row, source);
      const missingBoth = !String(row.product_name || '').trim() && !String(row.ingredients_text || '').trim();
      if (route.route === 'unknown' && missingBoth) {
        rows.push({
          source,
          barcode: row.code || '',
          product_name: row.product_name || '',
          ingredients_text: row.ingredients_text || '',
          resolver_source: route.source || '',
          resolver_rule_id: route.rule_id || ''
        });
      }
    }
  };
  scan('products_obf_index', 'open_beauty_facts');
  scan('products_off_index', 'open_food_facts');
  db.close();
  fs.mkdirSync(path.dirname(args.output), { recursive: true });
  const header = 'source,barcode,product_name,ingredients_text,resolver_source,resolver_rule_id';
  const lines = rows.map((r) =>
    [r.source, r.barcode, r.product_name, r.ingredients_text, r.resolver_source, r.resolver_rule_id].map(csvEscape).join(',')
  );
  fs.writeFileSync(args.output, `${header}\n${lines.join('\n')}\n`, 'utf8');
  console.log(`[category-missing-both] wrote ${args.output} rows=${rows.length}`);
}

main();
