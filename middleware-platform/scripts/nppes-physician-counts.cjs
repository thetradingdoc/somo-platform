#!/usr/bin/env node
'use strict';

/**
 * Print row counts for NPPES physician views (see migration 040).
 * Usage (from middleware-platform/): node scripts/nppes-physician-counts.cjs
 */
require('dotenv').config();
const path = require('path');
process.chdir(path.join(__dirname, '..'));

const Database = require('better-sqlite3');
const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'var', 'db', 'middleware-dev.db');
const db = new Database(dbPath, { readonly: true });

function hasView(name) {
  const r = db.prepare(`SELECT 1 FROM sqlite_master WHERE type='view' AND name=?`).get(name);
  return !!r;
}

const total = db.prepare(`SELECT COUNT(*) AS c FROM nppes_directory_providers`).get().c;
console.log('nppes_directory_providers (all):', total);

if (!hasView('nppes_v_physicians_md_do')) {
  console.log('\nViews missing. Run: npm run migrate   (applies migration 040_nppes_physician_views)');
  db.close();
  process.exit(0);
}

const mdDo = db.prepare(`SELECT COUNT(*) AS c FROM nppes_v_physicians_md_do`).get().c;
const spec = db.prepare(`SELECT COUNT(*) AS c FROM nppes_v_physicians_specialists`).get().c;

console.log('nppes_v_physicians_md_do (individual MD/DO, NUCC 207*):', mdDo);
console.log('nppes_v_physicians_specialists (same, excluding Family + Peds taxonomy codes):', spec);

console.log('\nTop 15 physician taxonomies (md_do view):');
console.table(
  db
    .prepare(
      `SELECT specialty_code, COUNT(*) AS n FROM nppes_v_physicians_md_do
       GROUP BY specialty_code ORDER BY n DESC LIMIT 15`
    )
    .all()
);

db.close();
