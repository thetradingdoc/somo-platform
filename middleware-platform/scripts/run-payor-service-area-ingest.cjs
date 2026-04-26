#!/usr/bin/env node
'use strict';

const Database = require('better-sqlite3');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH;
const SERVICE_AREA_CSV = process.env.SERVICE_AREA_CSV;
const DRY_RUN = process.argv.includes('--dry-run');

if (!DB_PATH || !SERVICE_AREA_CSV) {
  console.error('ERROR: DB_PATH and SERVICE_AREA_CSV env vars required');
  process.exit(1);
}

function parseCSVLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === ',' && !inQuotes) {
      out.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
}

function nullIfBlank(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === '' || s === 'N/A' ? null : s;
}

const lines = fs.readFileSync(SERVICE_AREA_CSV, 'utf8').split(/\r?\n/).filter(Boolean);
const headers = parseCSVLine(lines[0]).map((h) => h.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, ''));

const I = {
  contract_id: headers.indexOf('contract_id'),
  org_name: headers.indexOf('organization_name'),
  org_type: headers.indexOf('organization_type'),
  plan_type: headers.indexOf('plan_type'),
  partial: headers.indexOf('partial'),
  ssa: headers.indexOf('ssa'),
  fips: headers.indexOf('fips'),
  county: headers.indexOf('county'),
  state: headers.indexOf('state')
};
for (const k of ['contract_id', 'fips', 'county', 'state']) {
  if (I[k] === -1) throw new Error(`Required column not found: ${k}`);
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 30000');

if (!DRY_RUN) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS payor_plan_service_areas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      contract_id TEXT NOT NULL,
      county_fips TEXT NOT NULL,
      county_name TEXT,
      state_abbr TEXT,
      org_name TEXT,
      org_type TEXT,
      plan_type TEXT,
      partial TEXT,
      ssa_code TEXT,
      source TEXT DEFAULT 'cms_service_area_2026_04',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(contract_id, county_fips)
    );
    CREATE INDEX IF NOT EXISTS idx_ppsa_contract ON payor_plan_service_areas(contract_id);
    CREATE INDEX IF NOT EXISTS idx_ppsa_fips ON payor_plan_service_areas(county_fips);
    CREATE INDEX IF NOT EXISTS idx_ppsa_state ON payor_plan_service_areas(state_abbr);
  `);
}

const stmt = DRY_RUN ? null : db.prepare(`
  INSERT INTO payor_plan_service_areas
    (contract_id, county_fips, county_name, state_abbr, org_name, org_type, plan_type, partial, ssa_code, updated_at)
  VALUES
    (@contract_id, @county_fips, @county_name, @state_abbr, @org_name, @org_type, @plan_type, @partial, @ssa_code, datetime('now'))
  ON CONFLICT(contract_id, county_fips)
  DO UPDATE SET
    county_name = excluded.county_name,
    state_abbr = excluded.state_abbr,
    org_name = excluded.org_name,
    org_type = excluded.org_type,
    plan_type = excluded.plan_type,
    partial = excluded.partial,
    ssa_code = excluded.ssa_code,
    updated_at = datetime('now')
`);
const flush = DRY_RUN ? () => {} : db.transaction((rows) => rows.forEach((r) => stmt.run(r)));

const stats = { rows_read: 0, rows_parsed: 0, rows_upserted: 0, skipped: 0 };
let batch = [];
const BATCH = 5000;

for (let i = 1; i < lines.length; i += 1) {
  const cells = parseCSVLine(lines[i]);
  stats.rows_read += 1;
  const contract_id = nullIfBlank(cells[I.contract_id]);
  const fips = nullIfBlank(cells[I.fips]);
  if (!contract_id || !fips) {
    stats.skipped += 1;
    continue;
  }
  const rec = {
    contract_id,
    county_fips: fips.padStart(5, '0'),
    county_name: nullIfBlank(cells[I.county]),
    state_abbr: nullIfBlank(cells[I.state]),
    org_name: nullIfBlank(cells[I.org_name]),
    org_type: nullIfBlank(cells[I.org_type]),
    plan_type: nullIfBlank(cells[I.plan_type]),
    partial: nullIfBlank(cells[I.partial]),
    ssa_code: nullIfBlank(cells[I.ssa])
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
  event: 'payor_service_area_ingest_completed',
  dry_run: DRY_RUN,
  ...stats
}, null, 2));
db.close();
