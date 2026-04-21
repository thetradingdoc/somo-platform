#!/usr/bin/env node
'use strict';

/**
 * Stream NPPES endpoint_pfile_*.csv into nppes_fhir_endpoints (FHIR / payer-relevant URLs per NPI).
 *
 * Usage (from middleware-platform/):
 *   npm run migrate
 *   node scripts/import-nppes-fhir-endpoints.cjs
 *   node scripts/import-nppes-fhir-endpoints.cjs /path/to/endpoint_pfile_*.csv
 *   node scripts/import-nppes-fhir-endpoints.cjs --stdin < endpoint_pfile_....csv
 *   node scripts/import-nppes-fhir-endpoints.cjs --limit=5000
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { parse } = require('csv-parse');
const { findPreferredNppesEndpointCsvPath, getPayorDataSourcesRoot } = require('./payor-data-sources.cjs');

process.chdir(path.join(__dirname, '..'));

const db = require('../database');
const sqlite = db.db || db;
try {
  sqlite.pragma('journal_mode = WAL');
} catch (_) {}
const _bt = parseInt(process.env.SQLITE_BUSY_TIMEOUT_MS || '120000', 10);
sqlite.pragma(`busy_timeout = ${Number.isFinite(_bt) && _bt >= 0 ? Math.min(_bt, 600000) : 120000}`);

const { up: ensureTable } = require('../migrations/050_nppes_fhir_endpoints');

function hasTable(name) {
  const r = sqlite.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(name);
  return !!r;
}

if (!hasTable('nppes_fhir_endpoints')) {
  ensureTable(sqlite);
  console.error('✅ Created nppes_fhir_endpoints (migration 050)');
}

function arg(name, def = null) {
  const p = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!p) return def;
  return p.slice(name.length + 3);
}

const useStdin = process.argv.includes('--stdin');
let csvPath = process.argv.find((a) => !a.startsWith('-') && a.endsWith('.csv'));
const maxRows = parseInt(arg('limit', '0'), 10) || 0;

if (!useStdin) {
  if (!csvPath || !fs.existsSync(csvPath)) {
    const env = String(process.env.NPPES_ENDPOINT_CSV || '').trim();
    if (env) csvPath = path.isAbsolute(env) ? env : path.join(process.cwd(), env);
  }
  if (!csvPath || !fs.existsSync(csvPath)) {
    csvPath = findPreferredNppesEndpointCsvPath();
  }
}

if (!useStdin && (!csvPath || !fs.existsSync(csvPath))) {
  console.error(
    'Usage: node scripts/import-nppes-fhir-endpoints.cjs [/path/to/endpoint_pfile_*.csv] [--limit=N]\n' +
      '   or: ... | node scripts/import-nppes-fhir-endpoints.cjs --stdin [--limit=N]\n' +
      `   or: place endpoint CSV next to npidata under ${getPayorDataSourcesRoot()}/nppes/… or set NPPES_ENDPOINT_CSV`
  );
  process.exit(1);
}

function cell(row, ...names) {
  const keys = Object.keys(row);
  const lower = new Map(keys.map((k) => [k.trim().toLowerCase(), k]));
  for (const n of names) {
    const k = lower.get(n.trim().toLowerCase());
    if (k == null) continue;
    const v = row[k];
    if (v == null) continue;
    const s = String(v).trim();
    if (s !== '') return s;
  }
  return '';
}

function clean(s, max = 4000) {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  return max ? t.slice(0, max) : t;
}

function stableId(npi, url) {
  return `nppes_ep_${crypto.createHash('sha256').update(`${npi}\0${url}`).digest('hex').slice(0, 32)}`;
}

const insert = sqlite.prepare(`
  INSERT OR IGNORE INTO nppes_fhir_endpoints (
    id, npi, endpoint_type, endpoint_type_description, endpoint_url, affiliation, endpoint_description,
    affiliation_legal_business_name, use_code, use_description, other_use_description,
    content_type, content_description, other_content_description,
    affiliation_address_line_one, affiliation_address_line_two, affiliation_city, affiliation_state,
    affiliation_country, affiliation_postal_code, source_file
  ) VALUES (
    @id, @npi, @endpoint_type, @endpoint_type_description, @endpoint_url, @affiliation, @endpoint_description,
    @affiliation_legal_business_name, @use_code, @use_description, @other_use_description,
    @content_type, @content_description, @other_content_description,
    @affiliation_address_line_one, @affiliation_address_line_two, @affiliation_city, @affiliation_state,
    @affiliation_country, @affiliation_postal_code, @source_file
  )
`);

async function run() {
  const sourceFile = useStdin ? 'stdin' : path.basename(csvPath);
  const stats = { read: 0, inserted: 0, skipped_no_npi: 0, skipped_no_url: 0 };
  const batch = [];
  const BATCH = maxRows > 0 ? Math.min(800, Math.max(1, maxRows)) : 800;

  const flush = () => {
    if (!batch.length) return;
    const tx = sqlite.transaction((rows) => {
      for (const r of rows) {
        const info = insert.run(r);
        if (info.changes) stats.inserted += 1;
      }
    });
    tx(batch);
    batch.length = 0;
  };

  const input = useStdin ? process.stdin : fs.createReadStream(csvPath, { encoding: 'utf8' });
  const parser = input.pipe(
    parse({
      columns: true,
      relax_column_count: true,
      trim: true,
      bom: true,
      skip_empty_lines: true,
      relax_quotes: true
    })
  );

  const PROGRESS = Math.max(100000, parseInt(process.env.NPPES_ENDPOINT_IMPORT_PROGRESS_EVERY || '250000', 10) || 250000);
  console.error(`[import-nppes-fhir-endpoints] Streaming ${sourceFile}; progress every ${PROGRESS.toLocaleString()} rows.`);

  for await (const row of parser) {
    stats.read += 1;
    if (stats.read % PROGRESS === 0) {
      console.error(
        `[import-nppes-fhir-endpoints] read=${stats.read.toLocaleString()} inserted=${stats.inserted.toLocaleString()} ` +
          `skip npi=${stats.skipped_no_npi} url=${stats.skipped_no_url}`
      );
    }
    if (maxRows && stats.inserted >= maxRows) break;

    const npi = clean(cell(row, 'NPI'), 12);
    if (!npi || !/^\d{10}$/.test(npi)) {
      stats.skipped_no_npi += 1;
      continue;
    }
    const endpointUrl = clean(cell(row, 'Endpoint'), 8000);
    if (!endpointUrl) {
      stats.skipped_no_url += 1;
      continue;
    }

    batch.push({
      id: stableId(npi, endpointUrl),
      npi,
      endpoint_type: clean(cell(row, 'Endpoint Type'), 32) || null,
      endpoint_type_description: clean(cell(row, 'Endpoint Type Description'), 500) || null,
      endpoint_url: endpointUrl,
      affiliation: clean(cell(row, 'Affiliation'), 500) || null,
      endpoint_description: clean(cell(row, 'Endpoint Description'), 2000) || null,
      affiliation_legal_business_name: clean(cell(row, 'Affiliation Legal Business Name'), 500) || null,
      use_code: clean(cell(row, 'Use Code'), 64) || null,
      use_description: clean(cell(row, 'Use Description'), 500) || null,
      other_use_description: clean(cell(row, 'Other Use Description'), 500) || null,
      content_type: clean(cell(row, 'Content Type'), 500) || null,
      content_description: clean(cell(row, 'Content Description'), 500) || null,
      other_content_description: clean(cell(row, 'Other Content Description'), 500) || null,
      affiliation_address_line_one: clean(cell(row, 'Affiliation Address Line One'), 300) || null,
      affiliation_address_line_two: clean(cell(row, 'Affiliation Address Line Two'), 300) || null,
      affiliation_city: clean(cell(row, 'Affiliation Address City'), 120) || null,
      affiliation_state: clean(cell(row, 'Affiliation Address State'), 8) || null,
      affiliation_country: clean(cell(row, 'Affiliation Address Country'), 64) || null,
      affiliation_postal_code: clean(cell(row, 'Affiliation Address Postal Code'), 20) || null,
      source_file: sourceFile
    });

    if (batch.length >= BATCH) flush();
  }
  flush();

  console.log(JSON.stringify({ event: 'nppes_fhir_endpoints_import_completed', source_file: sourceFile, stats }, null, 2));
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
