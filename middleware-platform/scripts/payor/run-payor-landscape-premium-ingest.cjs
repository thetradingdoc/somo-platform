#!/usr/bin/env node
'use strict';

const Database = require('better-sqlite3');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH;
const LANDSCAPE_CSV = process.env.LANDSCAPE_CSV;
const DRY_RUN = process.argv.includes('--dry-run');

if (!DB_PATH || !LANDSCAPE_CSV) {
  console.error('ERROR: DB_PATH and LANDSCAPE_CSV env vars required');
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
  return s === '' || s === 'N/A' || s === 'NA' || s === 'Not Applicable' ? null : s;
}

function numOrNull(v) {
  const s = nullIfBlank(v);
  if (s === null) return null;
  const n = Number.parseFloat(s.replace(/[$,]/g, ''));
  return Number.isFinite(n) ? n : null;
}

const lines = fs.readFileSync(LANDSCAPE_CSV, 'utf8').split(/\r?\n/).filter(Boolean);
const headers = parseCSVLine(lines[0]).map((h) => h.toLowerCase().trim()
  .replace(/[()]/g, '').replace(/[\s/+]/g, '_').replace(/_+/g, '_'));

function col(name) {
  const idx = headers.findIndex((h) => h.includes(name));
  if (idx === -1) throw new Error(`Column not found: "${name}"`);
  return idx;
}

const IDX = {
  contract_id: col('contract_id'),
  plan_id: col('plan_id'),
  segment_id: col('segment_id'),
  state_abbr: col('state_territory_abbreviation'),
  county_name: col('county_name'),
  plan_name: col('plan_name'),
  org_name: col('organization_marketing_name'),
  plan_type: col('plan_type'),
  org_type: col('organization_type'),
  snp_indicator: col('special_needs_plan'),
  part_c_premium: col('part_c_premium'),
  monthly_premium: col('monthly_consolidated_premium'),
  part_d_deductible: col('annual_part_d_deductible'),
  moop: headers.findIndex((h) => h.includes('in-network_maximum_out-of-pocket') || h.includes('moop')),
  star_rating: col('overall_star_rating')
};

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 30000');

function ensureColumns(tableName, columnSqlByName) {
  const cols = db.prepare(`PRAGMA table_info(${tableName})`).all().map((c) => String(c.name || '').toLowerCase());
  Object.entries(columnSqlByName).forEach(([name, sql]) => {
    if (!cols.includes(String(name).toLowerCase())) {
      db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${sql}`);
    }
  });
}

function rebuildLegacyPremiumTableIfNeeded() {
  const cols = db.prepare('PRAGMA table_info(payor_plan_premiums)').all();
  const hasContractPrimaryKey = cols.some((c) => String(c.name) === 'contract_id' && Number(c.pk) === 1);
  if (!hasContractPrimaryKey) return;

  db.exec(`
    ALTER TABLE payor_plan_premiums RENAME TO payor_plan_premiums_legacy;
    CREATE TABLE payor_plan_premiums (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      contract_id TEXT NOT NULL,
      plan_id TEXT NOT NULL,
      segment_id TEXT NOT NULL DEFAULT '',
      state_abbr TEXT,
      county_name TEXT,
      plan_name TEXT,
      org_name TEXT,
      plan_type TEXT,
      org_type TEXT,
      snp_indicator TEXT,
      part_c_premium REAL,
      monthly_consolidated_premium REAL,
      annual_part_d_deductible REAL,
      moop_amount REAL,
      overall_star_rating REAL,
      source TEXT DEFAULT 'cms_landscape_2026',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(contract_id, plan_id, segment_id, state_abbr, county_name)
    );
    INSERT INTO payor_plan_premiums (
      contract_id, plan_id, segment_id, state_abbr, county_name, plan_name, org_name, plan_type,
      monthly_consolidated_premium, overall_star_rating, moop_amount, source, created_at, updated_at
    )
    SELECT
      contract_id,
      COALESCE(NULLIF(contract_id, ''), '') AS plan_id,
      '' AS segment_id,
      NULL AS state_abbr,
      NULL AS county_name,
      plan_name,
      org_name,
      plan_type,
      monthly_consolidated_premium,
      overall_star_rating,
      moop_amount,
      'legacy_migrated',
      datetime('now'),
      datetime('now')
    FROM payor_plan_premiums_legacy;
    DROP TABLE payor_plan_premiums_legacy;
  `);
}

if (!DRY_RUN) {
  rebuildLegacyPremiumTableIfNeeded();
  db.exec(`
    CREATE TABLE IF NOT EXISTS payor_plan_premiums (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      contract_id TEXT NOT NULL,
      plan_id TEXT NOT NULL,
      segment_id TEXT NOT NULL DEFAULT '',
      state_abbr TEXT,
      county_name TEXT,
      plan_name TEXT,
      org_name TEXT,
      plan_type TEXT,
      org_type TEXT,
      snp_indicator TEXT,
      part_c_premium REAL,
      monthly_consolidated_premium REAL,
      annual_part_d_deductible REAL,
      moop_amount REAL,
      overall_star_rating REAL,
      source TEXT DEFAULT 'cms_landscape_2026',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(contract_id, plan_id, segment_id, state_abbr, county_name)
    );
  `);
  ensureColumns('payor_plan_premiums', {
    plan_id: 'plan_id TEXT NOT NULL DEFAULT \'\'',
    segment_id: 'segment_id TEXT NOT NULL DEFAULT \'\'',
    state_abbr: 'state_abbr TEXT',
    county_name: 'county_name TEXT',
    org_type: 'org_type TEXT',
    snp_indicator: 'snp_indicator TEXT',
    part_c_premium: 'part_c_premium REAL',
    annual_part_d_deductible: 'annual_part_d_deductible REAL',
    source: 'source TEXT',
    created_at: 'created_at TEXT',
    updated_at: 'updated_at TEXT'
  });
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_ppp_state ON payor_plan_premiums(state_abbr);
    CREATE INDEX IF NOT EXISTS idx_ppp_premium ON payor_plan_premiums(monthly_consolidated_premium);
    CREATE INDEX IF NOT EXISTS idx_ppp_contract_plan ON payor_plan_premiums(contract_id, plan_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_ppp_contract_plan_seg_state_county_unique
      ON payor_plan_premiums(contract_id, plan_id, segment_id, state_abbr, county_name);
  `);
}

const stmt = DRY_RUN ? null : db.prepare(`
  INSERT INTO payor_plan_premiums
    (contract_id, plan_id, segment_id, state_abbr, county_name, plan_name, org_name, plan_type, org_type, snp_indicator,
     part_c_premium, monthly_consolidated_premium, annual_part_d_deductible, moop_amount, overall_star_rating, updated_at)
  VALUES
    (@contract_id, @plan_id, @segment_id, @state_abbr, @county_name, @plan_name, @org_name, @plan_type, @org_type, @snp_indicator,
     @part_c_premium, @monthly_consolidated_premium, @annual_part_d_deductible, @moop_amount, @overall_star_rating, datetime('now'))
  ON CONFLICT(contract_id, plan_id, segment_id, state_abbr, county_name)
  DO UPDATE SET
    plan_name = excluded.plan_name,
    org_name = excluded.org_name,
    plan_type = excluded.plan_type,
    org_type = excluded.org_type,
    snp_indicator = excluded.snp_indicator,
    part_c_premium = excluded.part_c_premium,
    monthly_consolidated_premium = excluded.monthly_consolidated_premium,
    annual_part_d_deductible = excluded.annual_part_d_deductible,
    moop_amount = excluded.moop_amount,
    overall_star_rating = excluded.overall_star_rating,
    updated_at = datetime('now')
`);

const flush = DRY_RUN ? () => {} : db.transaction((rows) => rows.forEach((r) => stmt.run(r)));

const stats = { rows_read: 0, rows_parsed: 0, rows_upserted: 0, skipped: 0 };
let batch = [];
const BATCH = 2000;

for (let i = 1; i < lines.length; i += 1) {
  const cells = parseCSVLine(lines[i]);
  stats.rows_read += 1;
  const contract_id = nullIfBlank(cells[IDX.contract_id]);
  const plan_id = nullIfBlank(cells[IDX.plan_id]);
  if (!contract_id || !plan_id) {
    stats.skipped += 1;
    continue;
  }
  const rec = {
    contract_id,
    plan_id,
    segment_id: nullIfBlank(cells[IDX.segment_id]) || '',
    state_abbr: nullIfBlank(cells[IDX.state_abbr]),
    county_name: nullIfBlank(cells[IDX.county_name]),
    plan_name: nullIfBlank(cells[IDX.plan_name]),
    org_name: nullIfBlank(cells[IDX.org_name]),
    plan_type: nullIfBlank(cells[IDX.plan_type]),
    org_type: nullIfBlank(cells[IDX.org_type]),
    snp_indicator: nullIfBlank(cells[IDX.snp_indicator]),
    part_c_premium: numOrNull(cells[IDX.part_c_premium]),
    monthly_consolidated_premium: numOrNull(cells[IDX.monthly_premium]),
    annual_part_d_deductible: numOrNull(cells[IDX.part_d_deductible]),
    moop_amount: IDX.moop >= 0 ? numOrNull(cells[IDX.moop]) : null,
    overall_star_rating: numOrNull(cells[IDX.star_rating])
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
  event: 'payor_landscape_premium_ingest_completed',
  dry_run: DRY_RUN,
  ...stats
}, null, 2));
db.close();
