#!/usr/bin/env node
'use strict';

const Database = require('better-sqlite3');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH;
const CROSSWALK_FILE = process.env.CROSSWALK_FILE;
const DRY_RUN = process.argv.includes('--dry-run');

if (!DB_PATH || !CROSSWALK_FILE) {
  console.error('ERROR: DB_PATH and CROSSWALK_FILE env vars required');
  process.exit(1);
}

const lines = fs.readFileSync(CROSSWALK_FILE, 'utf8').split(/\r?\n/).filter(Boolean);
const headers = lines[0].split('|').map((h) => h.trim().toLowerCase());

const I = {
  zip: headers.indexOf('geoid_zcta5_20'),
  fips: headers.indexOf('geoid_county_20'),
  county_name: headers.indexOf('namelsad_county_20'),
  area_land: headers.indexOf('arealand_part')
};
for (const k of ['zip', 'fips']) {
  if (I[k] === -1) throw new Error(`Required column not found: ${k}`);
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 30000');

if (!DRY_RUN) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS zip_county_crosswalk (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      zip_code TEXT NOT NULL,
      county_fips TEXT NOT NULL,
      county_name TEXT,
      area_land INTEGER,
      source TEXT DEFAULT 'census_zcta_2020',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(zip_code, county_fips)
    );
    CREATE INDEX IF NOT EXISTS idx_zcc_zip ON zip_county_crosswalk(zip_code);
    CREATE INDEX IF NOT EXISTS idx_zcc_fips ON zip_county_crosswalk(county_fips);
  `);
}

const stmt = DRY_RUN ? null : db.prepare(`
  INSERT INTO zip_county_crosswalk
    (zip_code, county_fips, county_name, area_land, updated_at)
  VALUES
    (@zip_code, @county_fips, @county_name, @area_land, datetime('now'))
  ON CONFLICT(zip_code, county_fips)
  DO UPDATE SET
    county_name = excluded.county_name,
    area_land = excluded.area_land,
    updated_at = datetime('now')
`);
const flush = DRY_RUN ? () => {} : db.transaction((rows) => rows.forEach((r) => stmt.run(r)));

const stats = { rows_read: 0, rows_parsed: 0, rows_upserted: 0, skipped: 0 };
let batch = [];
const BATCH = 5000;

for (let i = 1; i < lines.length; i += 1) {
  const cells = lines[i].split('|');
  stats.rows_read += 1;
  const zip = (cells[I.zip] || '').trim();
  const fips = (cells[I.fips] || '').trim();
  if (!zip || !fips || zip.length < 5) {
    stats.skipped += 1;
    continue;
  }
  const rec = {
    zip_code: zip.slice(0, 5),
    county_fips: fips.padStart(5, '0'),
    county_name: I.county_name >= 0 ? ((cells[I.county_name] || '').trim() || null) : null,
    area_land: I.area_land >= 0 ? (Number.parseInt(cells[I.area_land], 10) || null) : null
  };
  if (DRY_RUN && stats.rows_parsed < 3) console.log('[DRY]', JSON.stringify(rec));
  batch.push(rec);
  stats.rows_parsed += 1;
  if (batch.length >= BATCH) {
    flush(batch);
    if (!DRY_RUN) stats.rows_upserted += batch.length;
    batch = [];
  }
}
if (batch.length) {
  flush(batch);
  if (!DRY_RUN) stats.rows_upserted += batch.length;
}

console.log(JSON.stringify({
  event: 'payor_zip_county_crosswalk_ingest_completed',
  dry_run: DRY_RUN,
  ...stats
}, null, 2));
db.close();
