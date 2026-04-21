#!/usr/bin/env node
'use strict';

/**
 * Import Office Ally payor source data into payor_source_records.
 *
 * Usage:
 *   node scripts/import-payor-office-ally.cjs /path/to/file.csv
 *   node scripts/import-payor-office-ally.cjs /path/to/file.json --force
 *   node scripts/import-payor-office-ally.cjs /path/to/file.xlsx
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const {
  hasFlag,
  getArg,
  inferInputPathArg,
  pick,
  parseInputRows,
  validateSourceFile,
  fileChecksum,
  downloadToTempFile,
  uploadRawArtifactToGcs,
  emitIngestMetrics,
  recordPayorIngestRoutingSummary
} = require('./payor-ingest-utils.cjs');

process.chdir(path.join(__dirname, '..'));
const db = require('../database');

function mapRow(row, idx) {
  return {
    source_record_id: pick(row, ['source_record_id', 'id', 'row_id', 'payer_record_id']) || `office_ally_${idx + 1}`,
    raw_name: pick(row, ['raw_name', 'payer_name', 'payor_name', 'name', 'insurance_name']),
    raw_payer_id: pick(row, ['raw_payer_id', 'payer_id', 'payor_id', 'payerid', 'office_ally_payer_id']),
    raw_npi: pick(row, ['raw_npi', 'npi']),
    raw_ein: pick(row, ['raw_ein', 'ein', 'tax_id']),
    raw_state_hint: pick(row, ['raw_state_hint', 'state', 'state_hint']),
    payload_json: row
  };
}

async function main() {
  const localPathArg = inferInputPathArg();
  const sourceUrl = getArg('source-url', null);
  const force = hasFlag('force');
  let filePath = localPathArg;
  if (!filePath && sourceUrl) {
    filePath = await downloadToTempFile(sourceUrl, 'office_ally');
  }
  if (!filePath || !fs.existsSync(filePath)) {
    console.error('Usage: node scripts/import-payor-office-ally.cjs /path/to/file.(csv|json|xlsx) [--force] [--source-url=https://...]');
    process.exit(1);
  }

  const startedMs = Date.now();
  const source = 'office_ally';
  const checksum = fileChecksum(filePath);
  const existing = db.getPayorIngestBatchBySourceChecksum(source, checksum);
  if (existing && !force) {
    console.log(`Skipping import: source=${source} checksum already loaded (batch=${existing.id}, status=${existing.status})`);
    return;
  }

  const parsed = parseInputRows(filePath, { returnMeta: true });
  const rows = parsed.rows;
  const sourceValidation = validateSourceFile({
    source,
    headers: parsed.headers,
    previewText: parsed.preview_text
  });
  if (!sourceValidation.ok) {
    console.error(`Office Ally source validation failed: ${sourceValidation.reason}`);
    process.exit(1);
  }
  const batchId = `payor_batch_${uuidv4()}`;
  const fileSizeBytes = fs.statSync(filePath).size;
  let gcsUri = null;
  try {
    gcsUri = await uploadRawArtifactToGcs({ filePath, source, batchId, checksum });
  } catch (e) {
    console.warn('⚠️  Payor raw artifact GCS upload failed:', e.message);
  }

  db.createPayorIngestBatch({
    id: batchId,
    source,
    source_url: sourceUrl || null,
    file_name: path.basename(filePath),
    file_checksum: checksum,
    gcs_uri: gcsUri,
    file_size_bytes: fileSizeBytes,
    status: 'running'
  });

  let inserted = 0;
  let failed = 0;
  const tx = db.db.transaction((allRows) => {
    allRows.forEach((r, idx) => {
      try {
        const mapped = mapRow(r, idx);
        db.insertPayorSourceRecord({
          id: `payor_src_${uuidv4()}`,
          batch_id: batchId,
          source,
          ...mapped
        });
        inserted++;
      } catch (_) {
        failed++;
      }
    });
  });

  try {
    tx(rows);
    const finalStatus = failed > 0 ? 'completed_with_errors' : 'completed';
    db.completePayorIngestBatch(batchId, {
      record_count: inserted,
      status: finalStatus,
      error_summary: failed > 0 ? `failed_rows=${failed}` : null,
      gcs_uri: gcsUri,
      file_size_bytes: fileSizeBytes
    });
    console.log(`Imported Office Ally payor rows: inserted=${inserted}, failed=${failed}, batch=${batchId}, gcs=${gcsUri || 'none'}`);
    emitIngestMetrics({
      source,
      batchId,
      recordCount: inserted,
      failedCount: failed,
      status: finalStatus,
      elapsedMs: Date.now() - startedMs,
      gcsUri,
      routed_payor_rows: inserted,
      routed_provider_rows: 0,
      skipped_null_identity: 0
    });
    recordPayorIngestRoutingSummary(db.db, {
      source,
      batch_id: batchId,
      routed_payor_rows: inserted,
      routed_provider_rows: 0,
      skipped_null_identity: 0,
      failed,
      note: 'Office Ally importer does not split provider vs payor rows; counters are payor-shaped inserts only'
    });
  } catch (e) {
    db.completePayorIngestBatch(batchId, {
      record_count: inserted,
      status: 'failed',
      error_summary: e.message,
      gcs_uri: gcsUri,
      file_size_bytes: fileSizeBytes
    });
    console.error('Office Ally import failed:', e.message);
    emitIngestMetrics({
      source,
      batchId,
      recordCount: inserted,
      failedCount: failed,
      status: 'failed',
      elapsedMs: Date.now() - startedMs,
      gcsUri
    });
    process.exit(1);
  } finally {
    if (sourceUrl && filePath && fs.existsSync(filePath)) {
      try { fs.unlinkSync(filePath); } catch (_) {}
    }
  }
}

main();

