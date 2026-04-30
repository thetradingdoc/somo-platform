#!/usr/bin/env node
/**
 * Print zip_county_crosswalk row count and distinct ZIP count (uses app DB config).
 * For ad-hoc DB path: DB_PATH=/path/to.db node scripts/check-zip-crosswalk-row-count.cjs
 */
'use strict';

const db = require('../database');

function main() {
  try {
    const row = db.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='zip_county_crosswalk'")
      .get();
    if (!row) {
      console.log(JSON.stringify({ error: 'missing_table', table: 'zip_county_crosswalk' }, null, 2));
      process.exit(1);
      return;
    }
    const total = Number(db.db.prepare('SELECT COUNT(*) AS c FROM zip_county_crosswalk').get()?.c ?? 0);
    const distinctZips = Number(
      db.db
        .prepare(
          `SELECT COUNT(DISTINCT zip_code) AS c FROM zip_county_crosswalk
           WHERE zip_code IS NOT NULL AND TRIM(zip_code) != ''`
        )
        .get()?.c ?? 0
    );
    console.log(
      JSON.stringify(
        {
          zip_county_crosswalk_row_count: total,
          distinct_zip5_count: distinctZips,
          note: 'Expect high five-digit coverage for national search; re-run zip-county ingest if low.'
        },
        null,
        2
      )
    );
  } catch (e) {
    console.error(String(e && e.message ? e.message : e));
    process.exit(1);
  }
}

main();
