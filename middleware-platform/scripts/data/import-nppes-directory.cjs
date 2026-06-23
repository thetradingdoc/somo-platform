#!/usr/bin/env node
'use strict';

/**
 * Import CMS NPPES disseminated CSV (e.g. npidata_pfile_*.csv) into nppes_directory_providers.
 * Only rows that pass cleaning rules are inserted:
 *   - Active NPI (no deactivation date)
 *   - Display name (individual or organization), whitespace collapsed
 *   - Primary taxonomy code (10-char NUCC-style), non-empty display
 *   - US practice location only (country US or blank)
 *   - US state/territory code (2 letters)
 *   - Full practice address line 1, city, postal (5-digit ZIP base)
 *   - US-parseable phone (exactly 10 digits after normalization)
 *   - Optional: license only if both number and 2-letter state present
 *
 * Usage (from middleware-platform/):
 *   npm run migrate
 *   node scripts/data/import-nppes-directory.cjs /path/to/npidata_pfile_YYYYMMDD.csv
 *   node scripts/data/import-nppes-directory.cjs /path/to/file.csv --state=NY --limit=5000
 *
 * Stream from zip without extracting the ~11GB CSV:
 *   unzip -p data/payor-sources/nppes/NPPES_Data_Dissemination_March_2026_V2.zip npidata_pfile_....csv | \\
 *     node scripts/data/import-nppes-directory.cjs --stdin
 *
 * Canonical layout: put dissemination under data/payor-sources/nppes/ (see payor-data-sources.cjs), or set
 * NPPES_NPIDATA_CSV / NPPES_DISSEMINATION_DIR. With no path argument, the importer resolves npidata_pfile_*.csv automatically.
 *
 * Download: https://download.cms.gov/nppes/NPI_Files.html
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { parse } = require('csv-parse');

process.chdir(path.join(__dirname, '..'));

const db = require('../../database');
const { findPreferredNppesCsvPath, getPayorDataSourcesRoot } = require('../payor/payor-data-sources');
const sqlite = db.db || db;
// database.js sets WAL + busy_timeout; reinforce for standalone runs after other tools touched the file
try {
  sqlite.pragma('journal_mode = WAL');
} catch (_) {}
const _bt = parseInt(process.env.SQLITE_BUSY_TIMEOUT_MS || '120000', 10);
sqlite.pragma(`busy_timeout = ${Number.isFinite(_bt) && _bt >= 0 ? Math.min(_bt, 600000) : 120000}`);
const { up: ensureTable } = require('../../database/migrations/039_nppes_directory_providers');

function hasTable(name) {
  const r = sqlite.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(name);
  return !!r;
}

if (!hasTable('nppes_directory_providers')) {
  ensureTable(sqlite);
  console.log('✅ Created nppes_directory_providers (migration 039)');
}

function arg(name, def = null) {
  const p = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!p) return def;
  return p.slice(name.length + 3);
}

const useStdin = process.argv.includes('--stdin');
const csvPathArg = process.argv.find(
  (a) => !a.startsWith('-') && a !== '--stdin' && a.endsWith('.csv')
);
const filterState = (arg('state', '') || '').trim().toUpperCase() || null;
const maxRows = parseInt(arg('limit', '0'), 10) || 0;

let csvPath = csvPathArg;
if (!useStdin) {
  if (!csvPath || !fs.existsSync(csvPath)) {
    const envCsv = String(process.env.NPPES_NPIDATA_CSV || '').trim();
    if (envCsv) {
      csvPath = path.isAbsolute(envCsv) ? envCsv : path.join(process.cwd(), envCsv);
    }
  }
  if (!csvPath || !fs.existsSync(csvPath)) {
    csvPath = findPreferredNppesCsvPath();
  }
}

if (!useStdin && (!csvPath || !fs.existsSync(csvPath))) {
  console.error(
    'Usage: node scripts/data/import-nppes-directory.cjs /path/to/npidata_pfile_*.csv [--state=NY] [--limit=N]\n' +
      '   or: unzip -p archive.zip npidata_pfile_*.csv | node scripts/data/import-nppes-directory.cjs --stdin [--state=NY] [--limit=N]\n' +
      `   or: place NPPES under ${getPayorDataSourcesRoot()}/nppes/… and re-run with no path, or set NPPES_NPIDATA_CSV / NPPES_DISSEMINATION_DIR.\n` +
      '   Link an existing folder: node scripts/link-payor-nppes-dissemination.cjs /path/to/NPPES_Data_Dissemination_*_V2'
  );
  process.exit(1);
}
if (useStdin) {
  try {
    process.stdin.setEncoding('utf8');
  } catch (_) {
    /* ignore */
  }
}

/** US + territories / military postal (practice location state in NPPES). */
const US_PRACTICE_STATE = new Set([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY',
  'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH',
  'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
  'AS', 'GU', 'MP', 'PR', 'VI', 'UM', 'AE', 'AA', 'AP', 'PW', 'FM', 'MH',
]);

function cleanLine(s, maxLen) {
  const t = String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return '';
  return maxLen ? t.slice(0, maxLen) : t;
}

function validTaxonomyCode(code) {
  const c = String(code || '').trim().toUpperCase();
  if (c.length !== 10) return false;
  return /^[0-9]{3}[A-Z0-9]{6}X$/.test(c) || /^[0-9A-Z]{10}$/.test(c);
}

/** Case-insensitive column lookup (NPPES headers are stable but BOM/whitespace may vary). */
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

function normalizePhone(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('1')) return d.slice(1);
  if (d.length === 10) return d;
  return '';
}

function normalizeZip(z) {
  const s = String(z || '').trim();
  const m = s.match(/^(\d{5})(-\d{4})?$/);
  if (m) return m[1] + (m[2] || '');
  const digits = s.replace(/\D/g, '');
  if (digits.length >= 5) return digits.slice(0, 5);
  return '';
}

function normalizeState(s) {
  const t = String(s || '').trim().toUpperCase();
  if (t.length === 2) return t;
  return '';
}

function buildDisplayName(row, entityType) {
  const et = String(entityType || '').trim();
  if (et === '2') {
    const org = cell(row, 'Provider Organization Name (Legal Business Name)', 'Provider Organization Name');
    return org;
  }
  const parts = [
    cell(row, 'Provider Name Prefix Text'),
    cell(row, 'Provider First Name'),
    cell(row, 'Provider Middle Name'),
    cell(row, 'Provider Last Name (Legal Name)', 'Provider Last Name'),
    cell(row, 'Provider Name Suffix Text'),
  ].filter(Boolean);
  let name = parts.join(' ').replace(/\s+/g, ' ').trim();
  const cred = cell(row, 'Provider Credential Text');
  if (cred) name = `${name}, ${cred}`.trim();
  return name;
}

function firstLicense(row) {
  for (let i = 1; i <= 15; i++) {
    const num = cleanLine(
      cell(row, `Provider License Number_${i}`, `Provider License Number ${i}`),
      64
    );
    if (!num) continue;
    const st = normalizeState(cell(row, `Provider License Number State Code_${i}`, `Provider License Number State Code ${i}`));
    if (!st || !US_PRACTICE_STATE.has(st)) continue;
    return { license_number: num.slice(0, 64), license_state: st };
  }
  return { license_number: null, license_state: null };
}

function specialtyFields(row) {
  const code = cell(
    row,
    'Healthcare Provider Taxonomy Code_1',
    'Healthcare Provider Taxonomy Code 1'
  );
  let display = cell(
    row,
    'Healthcare Provider Taxonomy_1',
    'Healthcare Provider Taxonomy Text_1',
    'Provider Healthcare Provider Taxonomy_1'
  );
  if (!display) display = code;
  return { code, display: display || code };
}

function rowHash(row) {
  const stable = JSON.stringify(row, Object.keys(row).sort());
  return crypto.createHash('sha256').update(stable).digest('hex').slice(0, 32);
}

const insert = sqlite.prepare(`
  INSERT INTO nppes_directory_providers (
    npi, entity_type_code, display_name, credential, specialty_code, specialty_display,
    address_line_1, address_line_2, city, state, postal_code, country_code, phone,
    license_number, license_state, source, raw_row_hash, updated_at
  ) VALUES (
    @npi, @entity_type_code, @display_name, @credential, @specialty_code, @specialty_display,
    @address_line_1, @address_line_2, @city, @state, @postal_code, @country_code, @phone,
    @license_number, @license_state, @source, @raw_row_hash, datetime('now')
  )
  ON CONFLICT(npi) DO UPDATE SET
    entity_type_code = excluded.entity_type_code,
    display_name = excluded.display_name,
    credential = excluded.credential,
    specialty_code = excluded.specialty_code,
    specialty_display = excluded.specialty_display,
    address_line_1 = excluded.address_line_1,
    address_line_2 = excluded.address_line_2,
    city = excluded.city,
    state = excluded.state,
    postal_code = excluded.postal_code,
    country_code = excluded.country_code,
    phone = excluded.phone,
    license_number = excluded.license_number,
    license_state = excluded.license_state,
    source = excluded.source,
    raw_row_hash = excluded.raw_row_hash,
    updated_at = datetime('now')
`);

const stats = {
  read: 0,
  skipped_deactivated: 0,
  skipped_missing: 0,
  skipped_state: 0,
  skipped_phone: 0,
  skipped_non_us: 0,
  skipped_bad_taxonomy: 0,
  skipped_bad_state: 0,
  upserted: 0,
};

async function run() {
  const batch = [];
  const BATCH = 400;

  const flush = () => {
    if (!batch.length) return;
    const tx = sqlite.transaction((rows) => {
      for (const r of rows) insert.run(r);
    });
    tx(batch);
    stats.upserted += batch.length;
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
      relax_quotes: true,
    })
  );

  const PROGRESS_EVERY = Math.max(50000, parseInt(process.env.NPPES_IMPORT_PROGRESS_EVERY || '250000', 10) || 250000);
  console.error(
    `[nppes-import] Streaming CSV (full national file often 30–120+ min). Progress every ${PROGRESS_EVERY.toLocaleString()} rows read.`
  );

  for await (const row of parser) {
    stats.read += 1;
    if (stats.read % PROGRESS_EVERY === 0) {
      console.error(
        `[nppes-import] read=${stats.read.toLocaleString()} upserted=${stats.upserted.toLocaleString()} ` +
          `skip def=${stats.skipped_deactivated} miss=${stats.skipped_missing} phone=${stats.skipped_phone} ` +
          `tax=${stats.skipped_bad_taxonomy} st=${stats.skipped_bad_state} nonUS=${stats.skipped_non_us}`
      );
    }
    if (maxRows && stats.upserted >= maxRows) break;

    const deact = cell(row, 'NPI Deactivation Date', 'NPI Deactivation Date ');
    if (deact) {
      stats.skipped_deactivated += 1;
      continue;
    }

    const npi = cell(row, 'NPI');
    if (!npi || !/^\d{10}$/.test(npi)) {
      stats.skipped_missing += 1;
      continue;
    }

    const entityTypeRaw = cleanLine(cell(row, 'Entity Type Code'), 4);
    const entityType = entityTypeRaw === '1' || entityTypeRaw === '2' ? entityTypeRaw : null;
    let displayName = cleanLine(buildDisplayName(row, entityTypeRaw), 500);
    const { code: specCodeRaw, display: specDisplayRaw } = specialtyFields(row);
    const specCode = cleanLine(specCodeRaw, 20).toUpperCase();
    let specDisplay = cleanLine(specDisplayRaw || specCode, 300);
    const addr1 = cleanLine(
      cell(
        row,
        'Provider First Line Business Practice Location Address',
        'Provider First Line Business Practice Location Address '
      ),
      300
    );
    const addr2Raw = cleanLine(
      cell(
        row,
        'Provider Second Line Business Practice Location Address',
        'Provider Second Line Business Practice Location Address '
      ),
      300
    );
    const city = cleanLine(cell(row, 'Provider Business Practice Location Address City Name'), 120);
    const state = normalizeState(cell(row, 'Provider Business Practice Location Address State Name'));
    const zip = normalizeZip(cell(row, 'Provider Business Practice Location Address Postal Code'));
    const countryRaw = cleanLine(
      cell(
        row,
        'Provider Business Practice Location Address Country Code (If outside U.S.)',
        'Provider Business Practice Location Address Country Code'
      ),
      10
    ).toUpperCase();
    if (countryRaw && countryRaw !== 'US' && countryRaw !== 'USA') {
      stats.skipped_non_us += 1;
      continue;
    }
    const country_code = 'US';
    const phoneRaw = cell(
      row,
      'Provider Business Practice Location Address Telephone Number',
      'Provider Business Practice Location Address Telephone Number '
    );
    const phone = normalizePhone(phoneRaw);

    if (!validTaxonomyCode(specCode)) {
      stats.skipped_bad_taxonomy += 1;
      continue;
    }
    if (!specDisplay) specDisplay = specCode;
    if (!displayName || !addr1 || !city || !state || !zip || zip.length < 5) {
      stats.skipped_missing += 1;
      continue;
    }
    if (!US_PRACTICE_STATE.has(state)) {
      stats.skipped_bad_state += 1;
      continue;
    }
    if (filterState && state !== filterState) {
      stats.skipped_state += 1;
      continue;
    }
    if (!phone) {
      stats.skipped_phone += 1;
      continue;
    }

    const lic = firstLicense(row);
    const credRaw = cleanLine(cell(row, 'Provider Credential Text'), 32);
    const credential = credRaw || null;
    const addr2 = addr2Raw || null;

    batch.push({
      npi,
      entity_type_code: entityType,
      display_name: displayName,
      credential,
      specialty_code: specCode,
      specialty_display: specDisplay,
      address_line_1: addr1,
      address_line_2: addr2,
      city,
      state,
      postal_code: zip.slice(0, 15),
      country_code,
      phone,
      license_number: lic.license_number,
      license_state: lic.license_state,
      source: 'nppes',
      raw_row_hash: rowHash(row),
    });

    if (batch.length >= BATCH) flush();
  }

  flush();

  console.log('\n📋 NPPES import complete');
  console.log(JSON.stringify(stats, null, 2));
  console.log(`\nRows in table: ${sqlite.prepare('SELECT COUNT(*) AS c FROM nppes_directory_providers').get().c}`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
