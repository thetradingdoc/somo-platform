#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH;
const PBP_DIR = process.env.PBP_DIR;
const DRY_RUN = process.argv.includes('--dry-run');
const FILE_ARG = (process.argv.find((a) => a.startsWith('--file=')) || '').replace('--file=', '');
const INGEST_VERSION = 'v3';

if (!DB_PATH) {
  console.error('ERROR: DB_PATH env var required');
  process.exit(1);
}
if (!PBP_DIR) {
  console.error('ERROR: PBP_DIR env var required');
  process.exit(1);
}
if (!fs.existsSync(DB_PATH)) {
  console.error(`ERROR: DB not found: ${DB_PATH}`);
  process.exit(1);
}
if (!fs.existsSync(PBP_DIR)) {
  console.error(`ERROR: PBP_DIR not found: ${PBP_DIR}`);
  process.exit(1);
}

function nullIfBlank(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

function boolOrNull(v) {
  const s = nullIfBlank(v);
  if (s === null) return null;
  if (s === '1' || s.toLowerCase() === 'yes' || s.toLowerCase() === 'y' || s.toLowerCase() === 'true') return 1;
  if (s === '0' || s.toLowerCase() === 'no' || s.toLowerCase() === 'n' || s.toLowerCase() === 'false') return 0;
  return null;
}

function numOrNull(v) {
  const s = nullIfBlank(v);
  if (s === null) return null;
  const n = Number.parseFloat(s.replace(/[$,%]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function readTsv(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length < 2) return { headers: [], rows: [] };
  const headers = lines[0].split('\t').map((h) => String(h || '').trim().toLowerCase());
  const rows = lines.slice(1).map((line) => {
    const cells = line.split('\t');
    const obj = {};
    for (let i = 0; i < headers.length; i += 1) obj[headers[i]] = cells[i] ?? '';
    return obj;
  });
  return { headers, rows };
}

function firstHeader(headers, pred) {
  for (const h of headers) if (pred(h)) return h;
  return null;
}

function deriveSectionPrefixes(headers, fileStem) {
  const out = new Set();
  const filePrefix = fileStem.split('_').slice(0, 2).join('_'); // e.g. pbp_b14
  for (const h of headers) {
    // capture section-like prefixes e.g. pbp_b14c, pbp_b10a, pbp_b13i, pbp_b19b
    const m = h.match(/^(pbp_b\d+[a-z]?)/i);
    if (!m) continue;
    if (m[1].toLowerCase() === 'pbp_a') continue;
    out.add(m[1].toLowerCase());
  }
  // fallback if no explicit sections were found
  if (!out.size && filePrefix) out.add(filePrefix.toLowerCase());
  return Array.from(out).sort();
}

function extractForSection(row, headers, sectionPrefix) {
  const p = sectionPrefix.toLowerCase();

  const coveredKey = firstHeader(
    headers,
    (h) => h.startsWith(p) && (
      h.endsWith('_bendesc_yn') ||
      h.endsWith('_ben_cov_yn') ||
      h.endsWith('_covered_yn')
    )
  );
  const naOrNocKey = firstHeader(
    headers,
    (h) => h.startsWith(p) && (
      h.endsWith('_na_yn') ||
      h.endsWith('_noc_yn')
    )
  );
  const priorAuthKey = firstHeader(headers, (h) => h.startsWith(p) && h.endsWith('_auth_yn'));

  const copayMinKey = firstHeader(
    headers,
    (h) => h.startsWith(p) && h.includes('_copay_') && (
      h.endsWith('_min') || h.endsWith('_min_amt') || h.includes('_amt_min_') || h.endsWith('amt_min')
    )
  );
  const copayMaxKey = firstHeader(
    headers,
    (h) => h.startsWith(p) && h.includes('_copay_') && (
      h.endsWith('_max') || h.endsWith('_max_amt') || h.includes('_amt_max_') || h.endsWith('amt_max')
    )
  );

  const coinsMinKey = firstHeader(
    headers,
    (h) => h.startsWith(p) && h.includes('_coins_') && (
      h.endsWith('_min') || h.endsWith('_pct_min') || h.endsWith('_min_pct')
    )
  );
  const coinsMaxKey = firstHeader(
    headers,
    (h) => h.startsWith(p) && h.includes('_coins_') && (
      h.endsWith('_max') || h.endsWith('_pct_max') || h.endsWith('_max_pct')
    )
  );

  const maxPlanKey = firstHeader(headers, (h) => h.startsWith(p) && h.includes('_maxplan_') && h.endsWith('_amt'));
  const maxEnrKey = firstHeader(headers, (h) => h.startsWith(p) && h.includes('_maxenr_') && h.endsWith('_amt'));

  const orgType = nullIfBlank(row['orgtype']);
  const bendescRaw = coveredKey ? nullIfBlank(row[coveredKey]) : null;
  const naOrNocRaw = naOrNocKey ? nullIfBlank(row[naOrNocKey]) : null;

  let covered = null;
  let covered_source = 'inferred_null';

  if (naOrNocRaw === '1') {
    covered = 0;
    covered_source = 'not_applicable_indicator';
  } else if (bendescRaw === '1') {
    covered = 1;
    covered_source = 'bendesc_yn_explicit_1';
  } else if (bendescRaw === '0') {
    covered = 0;
    covered_source = 'bendesc_yn_explicit_0';
  } else if ((bendescRaw === null || bendescRaw === '') && orgType !== '08') {
    covered = 0;
    covered_source = 'bendesc_yn_blank_non_pace';
  }

  return {
    covered,
    covered_source,
    prior_auth_required: priorAuthKey ? boolOrNull(row[priorAuthKey]) : null,
    copay_min: copayMinKey ? numOrNull(row[copayMinKey]) : null,
    copay_max: copayMaxKey ? numOrNull(row[copayMaxKey]) : null,
    coinsurance_pct_min: coinsMinKey ? numOrNull(row[coinsMinKey]) : null,
    coinsurance_pct_max: coinsMaxKey ? numOrNull(row[coinsMaxKey]) : null,
    max_plan_amt: maxPlanKey ? numOrNull(row[maxPlanKey]) : null,
    max_enr_amt: maxEnrKey ? numOrNull(row[maxEnrKey]) : null
  };
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 30000');

if (!DRY_RUN) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS payor_plan_benefits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      contract_id TEXT NOT NULL,
      plan_id TEXT NOT NULL,
      segment_id TEXT NOT NULL DEFAULT '',
      benefit_category TEXT NOT NULL,
      benefit_label TEXT NOT NULL,
      benefit_file TEXT NOT NULL,
      covered INTEGER,
      covered_source TEXT,
      prior_auth_required INTEGER,
      copay_min REAL,
      copay_max REAL,
      coinsurance_pct_min REAL,
      coinsurance_pct_max REAL,
      max_plan_amt REAL,
      max_enr_amt REAL,
      raw_file TEXT NOT NULL,
      ingest_version TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(contract_id, plan_id, segment_id, benefit_file, benefit_label)
    );
    CREATE INDEX IF NOT EXISTS idx_ppb_contract_plan ON payor_plan_benefits(contract_id, plan_id);
    CREATE INDEX IF NOT EXISTS idx_ppb_category ON payor_plan_benefits(benefit_category);
    CREATE INDEX IF NOT EXISTS idx_ppb_covered ON payor_plan_benefits(covered);
  `);
  const cols = db.prepare(`PRAGMA table_info(payor_plan_benefits)`).all();
  const hasCoveredSource = cols.some((c) => String(c.name || '').toLowerCase() === 'covered_source');
  if (!hasCoveredSource) {
    db.exec(`ALTER TABLE payor_plan_benefits ADD COLUMN covered_source TEXT`);
  }
}

const upsert = DRY_RUN ? null : db.prepare(`
  INSERT INTO payor_plan_benefits (
    contract_id, plan_id, segment_id, benefit_category, benefit_label, benefit_file,
    covered, prior_auth_required, copay_min, copay_max, coinsurance_pct_min, coinsurance_pct_max,
    max_plan_amt, max_enr_amt, raw_file, ingest_version, updated_at, covered_source
  ) VALUES (
    @contract_id, @plan_id, @segment_id, @benefit_category, @benefit_label, @benefit_file,
    @covered, @prior_auth_required, @copay_min, @copay_max, @coinsurance_pct_min, @coinsurance_pct_max,
    @max_plan_amt, @max_enr_amt, @raw_file, @ingest_version, datetime('now'), @covered_source
  )
  ON CONFLICT(contract_id, plan_id, segment_id, benefit_file, benefit_label)
  DO UPDATE SET
    covered = excluded.covered,
    prior_auth_required = excluded.prior_auth_required,
    copay_min = excluded.copay_min,
    copay_max = excluded.copay_max,
    coinsurance_pct_min = excluded.coinsurance_pct_min,
    coinsurance_pct_max = excluded.coinsurance_pct_max,
    max_plan_amt = excluded.max_plan_amt,
    max_enr_amt = excluded.max_enr_amt,
    covered_source = excluded.covered_source,
    ingest_version = excluded.ingest_version,
    updated_at = datetime('now')
`);
const upsertTx = DRY_RUN ? null : db.transaction((records) => {
  for (const r of records) upsert.run(r);
});

const allTxt = fs.readdirSync(PBP_DIR).filter((f) => /^pbp_.*\.txt$/i.test(f)).sort();
const filesToProcess = FILE_ARG ? allTxt.filter((f) => f === FILE_ARG) : allTxt;
if (FILE_ARG && filesToProcess.length === 0) {
  console.error(`ERROR: file not found in PBP_DIR: ${FILE_ARG}`);
  process.exit(1);
}

const stats = {
  event: 'payor_pbp_benefits_ingest_completed',
  ingest_version: INGEST_VERSION,
  dry_run: DRY_RUN,
  files_discovered: allTxt.length,
  files_processed: 0,
  rows_read: 0,
  rows_upserted: 0,
  by_category: {},
  by_section: {}
};

for (const file of filesToProcess) {
  const filePath = path.join(PBP_DIR, file);
  const stem = file.replace(/\.txt$/i, '').toLowerCase();
  const category = stem.replace(/^pbp_/, '');
  const { headers, rows } = readTsv(filePath);
  if (!headers.length) continue;

  const sectionPrefixes = deriveSectionPrefixes(headers, stem);
  const out = [];

  for (const row of rows) {
    const contract_id = nullIfBlank(row['pbp_a_hnumber']);
    const plan_id = nullIfBlank(row['pbp_a_plan_identifier']);
    const segment_id = nullIfBlank(row['segment_id']) || '';
    if (!contract_id || !plan_id) continue;

    for (const sectionPrefix of sectionPrefixes) {
      const sig = extractForSection(row, headers, sectionPrefix);
      const rec = {
        contract_id,
        plan_id,
        segment_id,
        benefit_category: category,
        benefit_label: sectionPrefix,
        benefit_file: stem,
        ...sig,
        raw_file: file,
        ingest_version: INGEST_VERSION
      };
      out.push(rec);
      stats.rows_read += 1;

      if (!stats.by_section[sectionPrefix]) {
        stats.by_section[sectionPrefix] = {
          rows: 0,
          covered_1: 0,
          covered_0: 0,
          covered_null: 0
        };
      }
      const s = stats.by_section[sectionPrefix];
      s.rows += 1;
      if (rec.covered === 1) s.covered_1 += 1;
      else if (rec.covered === 0) s.covered_0 += 1;
      else s.covered_null += 1;
    }
  }

  if (!DRY_RUN && out.length) {
    upsertTx(out);
    stats.rows_upserted += out.length;
  }

  if (!stats.by_category[category]) stats.by_category[category] = 0;
  stats.by_category[category] += out.length;
  stats.files_processed += 1;

  if (DRY_RUN) {
    const preview = out.slice(0, 3).map((r) => ({
      contract_id: r.contract_id,
      plan_id: r.plan_id,
      segment_id: r.segment_id,
      benefit_category: r.benefit_category,
      benefit_label: r.benefit_label,
      covered: r.covered,
      copay_min: r.copay_min,
      copay_max: r.copay_max
    }));
    console.log(JSON.stringify({ file, rows: out.length, sections: sectionPrefixes, preview }, null, 2));
  }
}

for (const [k, v] of Object.entries(stats.by_section)) {
  const denom = v.rows || 1;
  v.covered_null_rate = Number((v.covered_null / denom).toFixed(4));
}

if (!DRY_RUN) {
  const total = db.prepare('SELECT COUNT(*) AS n FROM payor_plan_benefits').get();
  stats.table_total_rows = total.n;
}

console.log(JSON.stringify(stats, null, 2));
db.close();
