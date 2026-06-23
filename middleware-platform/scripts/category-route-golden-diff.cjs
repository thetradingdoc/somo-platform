#!/usr/bin/env node
'use strict';
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');
const { resolveCategoryRoute } = require('../services/catalog/category-route-resolver');

function parseArgs(argv) {
  const out = {
    fixture: path.join(__dirname, '..', 'tests', 'fixtures', 'category-route-golden.json')
  };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--fixture') out.fixture = String(argv[++i] || out.fixture);
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv);
  const rows = JSON.parse(fs.readFileSync(args.fixture, 'utf8'));
  const failures = [];
  for (const r of rows) {
    const out = resolveCategoryRoute({
      source: r.source,
      categories_tags: r.categories_tags || [],
      categories_hierarchy: r.categories_hierarchy || [],
      product_name: r.product_name || '',
      brands: r.brands || [],
      ingredients_text: r.ingredients_text || ''
    });
    if (out.route !== r.expected_route) {
      failures.push({
        code: r.code || null,
        expected_route: r.expected_route,
        actual_route: out.route,
        rule_id: out.rule_id
      });
    }
  }
  if (failures.length) {
    console.error('[category-route-golden-diff] FAIL');
    console.error(JSON.stringify(failures, null, 2));
    process.exitCode = 1;
    return;
  }
  console.log(`[category-route-golden-diff] PASS checked=${rows.length}`);
}

main();
