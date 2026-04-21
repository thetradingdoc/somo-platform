#!/usr/bin/env node
'use strict';

/**
 * Stream CMS NPPES npidata_pfile_*.csv into payor_source_records for payer ER.
 *
 * Only Entity Type Code 2 (organization) rows are inserted as source `nppes_bulk`.
 * Type 1 (individual) belongs in the provider directory path (`import:nppes-directory`),
 * not the payor ER table — inserting millions of practitioners here would drown normalization.
 *
 * Usage (from middleware-platform/):
 *   node scripts/import-payor-nppes-bulk.cjs /path/to/npidata_pfile_*.csv
 *   node scripts/import-payor-nppes-bulk.cjs   # resolves CSV under data/payor-sources/nppes/ (see payor-data-sources.cjs)
 *   node scripts/import-payor-nppes-bulk.cjs --stdin < /path/to/npidata_pfile_*.csv
 *   unzip -p NPPES_Data_Dissemination_*_V2.zip npidata_pfile_*.csv | node scripts/import-payor-nppes-bulk.cjs --stdin
 *
 * Options:
 *   --limit=N          Stop after N inserted rows (smoke test)
 *   --force            Ignore fingerprint dedupe for file path (same path/size/mtime)
 *   --checksum=SHA256  Treat as batch dedupe key (optional; for scripted re-runs)
 *   --require-min-rows=N  After import, exit 2 if fewer than N rows inserted (skipped duplicate batches do not count)
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse');
const { v4: uuidv4 } = require('uuid');
const {
  fileChecksum,
  emitIngestMetrics,
  uploadRawArtifactToGcs,
  recordPayorIngestRoutingSummary
} = require('./payor-ingest-utils.cjs');
const { findPreferredNppesCsvPath, getPayorDataSourcesRoot } = require('./payor-data-sources.cjs');

process.chdir(path.join(__dirname, '..'));
const db = require('../database');
const { logPayorIngestBanner } = require('./payor-sqlite-context.cjs');

const sqlite = db.db || db;
try {
  sqlite.pragma('journal_mode = WAL');
} catch (_) {}
const _bt = parseInt(process.env.SQLITE_BUSY_TIMEOUT_MS || '120000', 10);
sqlite.pragma(`busy_timeout = ${Number.isFinite(_bt) && _bt >= 0 ? Math.min(_bt, 600000) : 120000}`);

function arg(name, def = null) {
  const p = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!p) return def;
  return p.slice(name.length + 3);
}

const useStdin = process.argv.includes('--stdin');
const force = process.argv.includes('--force');
let csvPath = process.argv.find((a) => !a.startsWith('-') && a.endsWith('.csv'));
const maxRows = parseInt(arg('limit', '0'), 10) || 0;
const checksumArg = (arg('checksum', '') || '').trim().toLowerCase() || null;

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
    'Usage: node scripts/import-payor-nppes-bulk.cjs /path/to/npidata_pfile_*.csv [--limit=N] [--force]\n' +
      '   or: ... | node scripts/import-payor-nppes-bulk.cjs --stdin [--limit=N]\n' +
      `   or: link NPPES under ${getPayorDataSourcesRoot()}/nppes/ and re-run with no path:\n` +
      '       npm run setup:payor-data-sources:link-nppes -- /path/to/NPPES_Data_Dissemination_*_V2'
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

function cleanLine(s, maxLen) {
  const t = String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return '';
  return maxLen ? t.slice(0, maxLen) : t;
}

function normalizeState(s) {
  const t = String(s || '').trim().toUpperCase();
  return t.length === 2 ? t : '';
}

function fingerprintForFile(p) {
  const st = fs.statSync(p);
  const ino = typeof st.ino === 'bigint' ? st.ino.toString() : String(st.ino || 0);
  return `fp:${st.size}:${Math.floor(st.mtimeMs)}:${ino}`;
}

function buildPayload(row) {
  return {
    entity_type_code: '2',
    taxonomy_1: cleanLine(
      cell(row, 'Healthcare Provider Taxonomy Code_1', 'Healthcare Provider Taxonomy Code 1'),
      20
    ),
    practice_state: normalizeState(
      cell(row, 'Provider Business Practice Location Address State Name')
    ),
    practice_city: cleanLine(cell(row, 'Provider Business Practice Location Address City Name'), 120),
    country: cleanLine(
      cell(
        row,
        'Provider Business Practice Location Address Country Code (If outside U.S.)',
        'Provider Business Practice Location Address Country Code'
      ),
      10
    ).toUpperCase()
  };
}

async function main() {
  logPayorIngestBanner({ label: 'import-payor-nppes-bulk', databaseModule: db });
  const startedMs = Date.now();
  const source = 'nppes_bulk';
  let checksum = checksumArg;
  let fileName = 'stdin';
  let fileSizeBytes = null;
  let gcsUri = null;

  if (!useStdin && csvPath) {
    fileName = path.basename(csvPath);
    fileSizeBytes = fs.statSync(csvPath).size;
    if (!checksum) {
      if (fileSizeBytes < 50 * 1024 * 1024) {
        checksum = fileChecksum(csvPath);
      } else {
        checksum = fingerprintForFile(csvPath);
      }
    }
  } else {
    checksum = checksum || `stdin_${Date.now()}`;
  }

  if (checksum && !force) {
    const existing = db.getPayorIngestBatchBySourceChecksum(source, checksum);
    if (existing) {
      console.log(
        JSON.stringify(
          {
            event: 'payor_nppes_bulk_import_skipped',
            reason: 'duplicate_batch_fingerprint',
            batch_id: existing.id,
            checksum
          },
          null,
          2
        )
      );
      return { inserted: 0, skipped: true, reason: 'duplicate_batch_fingerprint' };
    }
  }

  const batchId = `payor_batch_${uuidv4()}`;
  db.createPayorIngestBatch({
    id: batchId,
    source,
    source_url: 'https://download.cms.gov/nppes/NPI_Files.html',
    file_name: fileName,
    file_checksum: checksum,
    gcs_uri: null,
    file_size_bytes: fileSizeBytes,
    status: 'running'
  });

  if (!useStdin && csvPath) {
    try {
      gcsUri = await uploadRawArtifactToGcs({ filePath: csvPath, source, batchId, checksum });
    } catch (e) {
      console.warn('⚠️  Payor raw artifact GCS upload failed:', e.message);
    }
  }

  const stats = {
    read: 0,
    inserted: 0,
    skipped_deactivated: 0,
    skipped_not_org: 0,
    skipped_bad_npi: 0,
    skipped_no_name: 0
  };

  const batch = [];
  const BATCH = maxRows > 0 ? Math.min(500, Math.max(1, maxRows)) : 500;
  const insertMany = sqlite.transaction((rows) => {
    for (const rec of rows) {
      db.insertPayorSourceRecord(rec);
    }
  });

  const flush = () => {
    if (!batch.length) return;
    insertMany(batch);
    stats.inserted += batch.length;
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

  const PROGRESS_EVERY = Math.max(
    50000,
    parseInt(process.env.NPPES_PAYOR_IMPORT_PROGRESS_EVERY || '250000', 10) || 250000
  );
  console.error(
    `[import-payor-nppes-bulk] Streaming (org rows only → ${source}). Progress every ${PROGRESS_EVERY.toLocaleString()} rows read.`
  );

  for await (const row of parser) {
    stats.read += 1;
    if (stats.read % PROGRESS_EVERY === 0) {
      console.error(
        `[import-payor-nppes-bulk] read=${stats.read.toLocaleString()} inserted=${stats.inserted.toLocaleString()} ` +
          `skip def=${stats.skipped_deactivated} notOrg=${stats.skipped_not_org} badNpi=${stats.skipped_bad_npi} noName=${stats.skipped_no_name}`
      );
    }
    if (maxRows && stats.inserted >= maxRows) break;

    const deact = cell(row, 'NPI Deactivation Date', 'NPI Deactivation Date ');
    if (deact) {
      stats.skipped_deactivated += 1;
      continue;
    }

    const et = cleanLine(cell(row, 'Entity Type Code'), 4);
    if (et !== '2') {
      stats.skipped_not_org += 1;
      continue;
    }

    const npi = cell(row, 'NPI');
    if (!npi || !/^\d{10}$/.test(npi)) {
      stats.skipped_bad_npi += 1;
      continue;
    }

    const orgName = cleanLine(
      cell(row, 'Provider Organization Name (Legal Business Name)', 'Provider Organization Name'),
      500
    );
    if (!orgName) {
      stats.skipped_no_name += 1;
      continue;
    }

    const stateHint = normalizeState(cell(row, 'Provider Business Practice Location Address State Name'));

    batch.push({
      id: `payor_src_${uuidv4()}`,
      batch_id: batchId,
      source,
      source_record_id: `nppes_org_${npi}`,
      raw_name: orgName,
      raw_payer_id: null,
      raw_npi: npi,
      raw_ein: null,
      raw_state_hint: stateHint || null,
      payload_json: buildPayload(row)
    });

    if (batch.length >= BATCH) flush();
  }

  flush();

  db.completePayorIngestBatch(batchId, {
    record_count: stats.inserted,
    status: 'completed',
    error_summary: null,
    gcs_uri: gcsUri,
    file_size_bytes: fileSizeBytes
  });

  console.log(
    JSON.stringify(
      {
        event: 'payor_nppes_bulk_import_completed',
        batch_id: batchId,
        checksum,
        gcs_uri: gcsUri,
        stats
      },
      null,
      2
    )
  );

  emitIngestMetrics({
    source,
    batchId,
    recordCount: stats.inserted,
    failedCount: 0,
    status: 'completed',
    elapsedMs: Date.now() - startedMs,
    gcsUri,
    routed_payor_rows: stats.inserted,
    routed_provider_rows: stats.skipped_not_org,
    skipped_null_identity: 0
  });
  recordPayorIngestRoutingSummary(sqlite, {
    source,
    batch_id: batchId,
    read_rows: stats.read,
    routed_payor_rows: stats.inserted,
    routed_provider_rows: stats.skipped_not_org,
    skipped_null_identity: 0,
    skipped_deactivated: stats.skipped_deactivated,
    skipped_bad_npi: stats.skipped_bad_npi,
    skipped_no_name: stats.skipped_no_name,
    note: 'Type 1 rows counted as routed_provider_rows (provider directory path, not payor ER)'
  });

  return { inserted: stats.inserted, skipped: false };
}

const requireMinRows = parseInt(arg('require-min-rows', '0'), 10) || 0;

main()
  .then((res) => {
    if (!res) return;
    if (requireMinRows > 0 && !res.skipped && res.inserted < requireMinRows) {
      console.error(
        JSON.stringify(
          {
            event: 'payor_nppes_bulk_import_failed',
            reason: 'require_min_rows_not_met',
            inserted: res.inserted,
            require_min_rows: requireMinRows
          },
          null,
          2
        )
      );
      process.exit(2);
    }
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
