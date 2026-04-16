#!/usr/bin/env node
'use strict';

/**
 * Post-import cleanup for nppes_directory_providers:
 * - DELETE rows with empty/invalid required fields
 * - Turn "" into NULL on optional columns (no empty-string placeholders)
 * - Drop orphan license rows (number without state)
 *
 * Usage (from middleware-platform/):
 *   node scripts/nppes-directory-clean.cjs
 *   node scripts/nppes-directory-clean.cjs --vacuum
 */

require('dotenv').config();
const path = require('path');
process.chdir(path.join(__dirname, '..'));

const db = require('../database');
const sqlite = db.db || db;

const doVacuum = process.argv.includes('--vacuum');

function hasTable(name) {
  const r = sqlite.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(name);
  return !!r;
}

if (!hasTable('nppes_directory_providers')) {
  console.error('Table nppes_directory_providers does not exist. Run migrations + import first.');
  process.exit(1);
}

const before = sqlite.prepare('SELECT COUNT(*) AS c FROM nppes_directory_providers').get().c;

const updates = [
  `UPDATE nppes_directory_providers SET address_line_2 = NULL
     WHERE address_line_2 IS NOT NULL AND TRIM(address_line_2) = ''`,
  `UPDATE nppes_directory_providers SET credential = NULL
     WHERE credential IS NOT NULL AND TRIM(credential) = ''`,
  `UPDATE nppes_directory_providers SET entity_type_code = NULL
     WHERE entity_type_code IS NOT NULL AND TRIM(entity_type_code) = ''`,
  `UPDATE nppes_directory_providers SET license_number = NULL, license_state = NULL
     WHERE license_number IS NOT NULL AND (license_state IS NULL OR TRIM(license_state) = '')`,
  `UPDATE nppes_directory_providers SET license_number = NULL, license_state = NULL
     WHERE license_state IS NOT NULL AND (license_number IS NULL OR TRIM(license_number) = '')`,
  `UPDATE nppes_directory_providers SET raw_row_hash = NULL
     WHERE raw_row_hash IS NOT NULL AND TRIM(raw_row_hash) = ''`,
];

const delInvalid = `
  DELETE FROM nppes_directory_providers WHERE
    npi IS NULL OR TRIM(npi) = '' OR LENGTH(TRIM(npi)) != 10
    OR display_name IS NULL OR TRIM(display_name) = ''
    OR specialty_code IS NULL OR TRIM(specialty_code) = ''
    OR LENGTH(TRIM(specialty_code)) != 10
    OR specialty_display IS NULL OR TRIM(specialty_display) = ''
    OR address_line_1 IS NULL OR TRIM(address_line_1) = ''
    OR city IS NULL OR TRIM(city) = ''
    OR state IS NULL OR TRIM(state) = '' OR LENGTH(TRIM(state)) != 2
    OR postal_code IS NULL OR TRIM(postal_code) = ''
    OR SUBSTR(TRIM(postal_code), 1, 5) NOT GLOB '[0-9][0-9][0-9][0-9][0-9]'
    OR phone IS NULL OR TRIM(phone) = ''
    OR TRIM(phone) NOT GLOB '[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]'
    OR source IS NULL OR TRIM(source) = ''
    OR country_code IS NULL OR TRIM(country_code) = ''
`;

console.log(`Rows before cleanup: ${before}`);

const tx = sqlite.transaction(() => {
  for (const sql of updates) {
    const r = sqlite.prepare(sql).run();
    if (r.changes) console.log(`  UPDATE (${r.changes} rows): ${sql.slice(0, 72)}…`);
  }
  const d = sqlite.prepare(delInvalid).run();
  console.log(`  DELETE invalid required fields: ${d.changes} rows`);
});

tx();

const after = sqlite.prepare('SELECT COUNT(*) AS c FROM nppes_directory_providers').get().c;
console.log(`Rows after cleanup: ${after} (removed ${before - after})`);

if (doVacuum) {
  console.log('Running VACUUM (may take several minutes)…');
  sqlite.exec('VACUUM');
  console.log('VACUUM done.');
}
