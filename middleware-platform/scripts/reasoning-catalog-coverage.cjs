#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * X2 — Catalog + reasoning coverage report (read-only SQLite).
 *
 * Usage:
 *   node scripts/reasoning-catalog-coverage.cjs /path/to/data.sqlite
 */
const Database = require('better-sqlite3');
const { getCatalogCoverageMetrics } = require('../services/catalog-coverage-metrics');

function main() {
  const dbPath = process.argv[2];
  if (!dbPath) {
    console.error('Usage: node scripts/reasoning-catalog-coverage.cjs <sqlite.db>');
    process.exit(1);
  }
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  const report = getCatalogCoverageMetrics(db);
  db.close();
  console.log(JSON.stringify(report, null, 2));
}

main();
