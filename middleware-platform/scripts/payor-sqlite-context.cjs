#!/usr/bin/env node
/**
 * Single place for "which SQLite + which NPPES CSV + how many nppes_bulk rows" — avoids migrate vs import DB drift.
 *
 *   node scripts/payor-sqlite-context.cjs
 *   npm run verify:payor:sqlite-context
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { findPreferredNppesCsvPath, getPayorDataSourcesRoot } = require('./payor-data-sources.cjs');

function buildPayorSqliteContext(databaseModule) {
  const sqlite_path = databaseModule.sqliteDatabasePath || null;
  const db_path_env = (process.env.DB_PATH && String(process.env.DB_PATH).trim()) || null;
  const cwd = process.cwd();
  let nppes_bulk_csv = null;
  let nppes_bulk_csv_bytes = null;
  try {
    const p = findPreferredNppesCsvPath(cwd);
    if (p && fs.existsSync(p)) {
      nppes_bulk_csv = p;
      nppes_bulk_csv_bytes = fs.statSync(p).size;
    }
  } catch (_) {
    /* optional path discovery */
  }
  let nppes_bulk_source_rows = null;
  let nppes_bulk_normalized_rows = null;
  try {
    nppes_bulk_source_rows = Number(
      databaseModule.db.prepare(`SELECT COUNT(*) AS c FROM payor_source_records WHERE source = 'nppes_bulk'`).get()?.c ?? 0
    );
    nppes_bulk_normalized_rows = Number(
      databaseModule.db.prepare(`SELECT COUNT(*) AS c FROM payor_normalized_records WHERE source = 'nppes_bulk'`).get()?.c ?? 0
    );
  } catch (_) {
    /* tables missing in very early DB */
  }
  return {
    event: 'payor_sqlite_context',
    sqlite_path,
    db_path_env,
    cwd,
    payor_data_sources_root: getPayorDataSourcesRoot(cwd),
    nppes_bulk_csv,
    nppes_bulk_csv_bytes,
    nppes_bulk_source_rows,
    nppes_bulk_normalized_rows
  };
}

function logPayorIngestBanner({ label, databaseModule }) {
  const c = buildPayorSqliteContext(databaseModule);
  console.error(
    `[${label}] sqlite=${c.sqlite_path} DB_PATH_env=${c.db_path_env || '(unset)'} cwd=${c.cwd}`
  );
  if (c.nppes_bulk_csv) {
    console.error(
      `[${label}] npidata_csv=${c.nppes_bulk_csv} size_bytes=${String(c.nppes_bulk_csv_bytes)}`
    );
  } else {
    console.error(
      `[${label}] npidata_csv=(none — set NPPES_NPIDATA_CSV / NPPES_DISSEMINATION_DIR or npm run setup:payor-data-sources:link-nppes)`
    );
  }
  console.error(
    `[${label}] row_counts nppes_bulk source=${c.nppes_bulk_source_rows ?? 'n/a'} normalized=${c.nppes_bulk_normalized_rows ?? 'n/a'}`
  );
}

if (require.main === module) {
  require('dotenv').config();
  process.chdir(path.join(__dirname, '..'));
  const db = require('../database');
  const payload = buildPayorSqliteContext(db);
  console.log(JSON.stringify(payload, null, 2));
}

module.exports = { buildPayorSqliteContext, logPayorIngestBanner };
