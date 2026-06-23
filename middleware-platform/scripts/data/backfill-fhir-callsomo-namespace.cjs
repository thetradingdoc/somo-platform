#!/usr/bin/env node
'use strict';

/**
 * Replace legacy doclittle.health FHIR URLs in SQLite JSON columns.
 * Usage: DB_PATH=./middleware-dev.db node scripts/data/backfill-fhir-callsomo-namespace.cjs [--dry-run]
 */

const Database = require('better-sqlite3');
const path = require('path');
const { LEGACY_HEALTH_BASE, FHIR_BASE, normalizeExtensionUrl } = require('../../lib/fhir-brand-identifiers');

const dryRun = process.argv.includes('--dry-run');
const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'middleware-dev.db');
const db = new Database(dbPath);

const TABLES = [
  { table: 'fhir_encounters', column: 'resource_data' },
  { table: 'fhir_patients', column: 'resource_data' },
  { table: 'fhir_communications', column: 'resource_data' },
  { table: 'fhir_observations', column: 'resource_data' }
];

function rewriteJson(text) {
  if (!text || !text.includes(LEGACY_HEALTH_BASE)) return null;
  let next = text.split(LEGACY_HEALTH_BASE).join(FHIR_BASE);
  // extension paths: .../fhir/extension/foo -> .../fhir/StructureDefinition/foo
  next = next.replace(
    /https:\/\/callsomo\.com\/fhir\/extension\//g,
    'https://callsomo.com/fhir/StructureDefinition/'
  );
  return next === text ? null : next;
}

let updated = 0;
for (const { table, column } of TABLES) {
  const exists = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
    .get(table);
  if (!exists) continue;
  const rows = db.prepare(`SELECT rowid, ${column} AS data FROM ${table}`).all();
  const upd = db.prepare(`UPDATE ${table} SET ${column} = ? WHERE rowid = ?`);
  for (const row of rows) {
    const next = rewriteJson(row.data);
    if (!next) continue;
    updated += 1;
    if (!dryRun) upd.run(next, row.rowid);
  }
}

console.log(
  dryRun
    ? `[dry-run] Would update ${updated} FHIR JSON row(s) in ${dbPath}`
    : `Updated ${updated} FHIR JSON row(s) in ${dbPath}`
);
