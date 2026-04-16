#!/usr/bin/env node
'use strict';
/* eslint-disable no-console */
/**
 * Step-0 audit: coverage of ingredients / categories in local SQLite index tables,
 * and optional stream audit of the OBF baseline CSV.gz in GCS (same shape as ingestion).
 *
 * Usage:
 *   node scripts/audit-catalog-index-stats.cjs [path/to/middleware.db]
 *   node scripts/audit-catalog-index-stats.cjs --gcs-obf
 *   node scripts/audit-catalog-index-stats.cjs --gcs-only
 *   node scripts/audit-catalog-index-stats.cjs --gcs-obf --gcs-uri gs://bucket/path/file.csv.gz
 *
 * Env: MIDDLEWARE_DB_PATH or DB_PATH overrides SQLite file when no path argument is given.
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { createGunzip } = require('zlib');
const { parse } = require('csv-parse');

const DEFAULT_GCS_OBF =
  process.env.OBF_GCS_BASELINE_URI ||
  'gs://skinandcare-media-staging/obf/raw/full/en.openbeautyfacts.org.products.csv.gz';

function findDbPath(argv) {
  const args = argv.slice(2).filter((a) => !a.startsWith('--'));
  const first = args[0];
  if (first && fs.existsSync(first)) return first;
  const env = process.env.MIDDLEWARE_DB_PATH || process.env.DB_PATH;
  if (env && fs.existsSync(env)) return env;
  const candidates = [
    path.join(__dirname, '..', 'middleware.db'),
    path.join(__dirname, '..', 'middleware-dev.db'),
    path.join(__dirname, '..', 'middleware-prod.db')
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

function tableExists(db, name) {
  const row = db
    .prepare(`SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name=?`)
    .get(name);
  return !!row;
}

function auditSqlite(dbPath) {
  const Database = require('better-sqlite3');
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    console.log(`\n=== SQLite index audit (${dbPath}) ===\n`);

    if (tableExists(db, 'products_obf_index')) {
      const obf = db.prepare(`
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN ingredients_text IS NOT NULL AND TRIM(ingredients_text) != '' THEN 1 ELSE 0 END) AS has_ingredients_text,
          SUM(CASE WHEN ingredients_tags_json IS NOT NULL AND TRIM(ingredients_tags_json) NOT IN ('', '[]') THEN 1 ELSE 0 END) AS has_ingredients_tags,
          SUM(CASE WHEN ingredients_analysis_tags_json IS NOT NULL AND TRIM(ingredients_analysis_tags_json) NOT IN ('', '[]') THEN 1 ELSE 0 END) AS has_analysis_tags,
          SUM(CASE WHEN categories_tags_json IS NULL OR TRIM(categories_tags_json) IN ('', '[]') THEN 1 ELSE 0 END) AS missing_categories
        FROM products_obf_index
      `).get();
      console.log('products_obf_index:', obf);
      const obfBadJson = db.prepare(`
        SELECT
          SUM(
            CASE
              WHEN categories_tags_json IS NOT NULL
               AND TRIM(categories_tags_json) NOT IN ('', '[]')
               AND json_valid(categories_tags_json) = 0
              THEN 1 ELSE 0 END
          ) AS malformed_categories_tags_json
        FROM products_obf_index
      `).get();
      console.log('products_obf_index_quality:', obfBadJson);
    } else {
      console.log('products_obf_index: (table missing)');
    }

    if (tableExists(db, 'products_off_index')) {
      const off = db.prepare(`
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN ingredients_text IS NOT NULL AND TRIM(ingredients_text) != '' THEN 1 ELSE 0 END) AS has_ingredients_text,
          SUM(CASE WHEN ingredients_tags_json IS NOT NULL AND TRIM(ingredients_tags_json) NOT IN ('', '[]') THEN 1 ELSE 0 END) AS has_ingredients_tags,
          SUM(CASE WHEN ingredients_analysis_tags_json IS NOT NULL AND TRIM(ingredients_analysis_tags_json) NOT IN ('', '[]') THEN 1 ELSE 0 END) AS has_analysis_tags,
          SUM(CASE WHEN categories_tags_json IS NULL OR TRIM(categories_tags_json) IN ('', '[]') THEN 1 ELSE 0 END) AS missing_categories
        FROM products_off_index
      `).get();
      console.log('products_off_index:', off);
      const offBadJson = db.prepare(`
        SELECT
          SUM(
            CASE
              WHEN categories_tags_json IS NOT NULL
               AND TRIM(categories_tags_json) NOT IN ('', '[]')
               AND json_valid(categories_tags_json) = 0
              THEN 1 ELSE 0 END
          ) AS malformed_categories_tags_json
        FROM products_off_index
      `).get();
      console.log('products_off_index_quality:', offBadJson);
      console.log(
        '(Note: additives_nova_nutriscore are not columns on products_off_index in this repo; use raw OFF CSV or API if needed.)'
      );
    } else {
      console.log('products_off_index: (table missing)');
    }
  } finally {
    db.close();
  }
}

async function auditGcsObfCsv(gcsUri) {
  const { resolveCategoryRoute } = require('../services/category-route-resolver');
  console.log(`\n=== GCS OBF baseline CSV stream (${gcsUri}) ===\n`);
  const gs = spawn('gsutil', ['cat', gcsUri], { stdio: ['ignore', 'pipe', 'inherit'] });
  const gunzip = createGunzip();
  gs.stdout.pipe(gunzip);
  let parseFailed = 0;
  const parser = gunzip.pipe(
    parse({
      delimiter: '\t',
      columns: true,
      relax_column_count: true,
      relax_quotes: true,
      skip_records_with_error: true,
      on_skip: () => { parseFailed += 1; },
      bom: true
    })
  );

  let total = 0;
  let hasIngredientsText = 0;
  let hasIngredientsTags = 0;
  let hasAnalysisTags = 0;
  let missingCategories = 0;
  let unknownRoute = 0;
  const routeCounts = {};

  for await (const row of parser) {
    total += 1;
    const it = String(row.ingredients_text || '').trim();
    if (it) hasIngredientsText += 1;
    if (String(row.ingredients_tags || '').trim()) hasIngredientsTags += 1;
    if (String(row.ingredients_analysis_tags || '').trim()) hasAnalysisTags += 1;
    const rawCat = String(row.categories_tags || '').trim();
    if (!rawCat) missingCategories += 1;
    const categoriesTags = rawCat ? rawCat.split(',').map((x) => String(x || '').trim()).filter(Boolean) : [];
    const categoriesHierarchy = String(row.categories_hierarchy || '').trim()
      ? String(row.categories_hierarchy).split(',').map((x) => String(x || '').trim()).filter(Boolean)
      : [];
    const resolved = resolveCategoryRoute({
      source: 'open_beauty_facts',
      categories_tags: categoriesTags,
      categories_hierarchy: categoriesHierarchy
    });
    routeCounts[resolved.route] = (routeCounts[resolved.route] || 0) + 1;
    if (resolved.route === 'unknown') unknownRoute += 1;
  }

  console.log({
    total,
    has_ingredients_text: hasIngredientsText,
    has_ingredients_tags: hasIngredientsTags,
    has_analysis_tags: hasAnalysisTags,
    missing_categories_tags: missingCategories,
    parse_failed: parseFailed,
    unknown_after_map: unknownRoute,
    resolved_by_map: total - unknownRoute,
    route_counts: routeCounts
  });
}

async function main() {
  const argv = process.argv;
  const wantGcs = argv.includes('--gcs-obf') || argv.includes('--gcs-only');
  const gcsOnly = argv.includes('--gcs-only');
  const uriIdx = argv.indexOf('--gcs-uri');
  const gcsUri = uriIdx >= 0 ? String(argv[uriIdx + 1] || '').trim() || DEFAULT_GCS_OBF : DEFAULT_GCS_OBF;

  const dbPath = gcsOnly ? null : findDbPath(argv);
  if (dbPath) {
    auditSqlite(dbPath);
  } else if (!wantGcs) {
    console.error(
      'No SQLite file found. Pass a .db path, set MIDDLEWARE_DB_PATH, or run with --gcs-obf.\n' +
        'Tried: middleware.db, middleware-dev.db, middleware-prod.db under middleware-platform/.'
    );
    process.exitCode = 1;
  }

  if (wantGcs) {
    await auditGcsObfCsv(gcsUri);
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
