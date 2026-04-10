#!/usr/bin/env node
'use strict';
/* eslint-disable no-console */

const readline = require('readline');
const zlib = require('zlib');
const { Readable } = require('stream');
const { Storage } = require('@google-cloud/storage');
const db = require('../database');
const Metrics = require('../services/metrics');
const { normalizeObfDocument } = require('./obf-normalize-record.cjs');

const DEFAULT_SOURCE_URL = 'https://static.openbeautyfacts.org/data/en.openbeautyfacts.org.products.csv.gz';

function parseArgs(argv) {
  const out = {
    sourceUrl: process.env.OBF_BASELINE_URL || DEFAULT_SOURCE_URL,
    gcsPrefix: process.env.OBF_GCS_PREFIX || 'gs://skinandcare-media-staging/obf'
  };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--source-url') out.sourceUrl = String(argv[++i] || out.sourceUrl);
    else if (argv[i] === '--gcs-prefix') out.gcsPrefix = String(argv[++i] || out.gcsPrefix);
  }
  return out;
}

function parseGcsPrefix(prefix) {
  const clean = String(prefix || '').replace(/\/$/, '');
  const m = clean.match(/^gs:\/\/([^/]+)(?:\/(.*))?$/);
  if (!m) throw new Error(`invalid_gcs_prefix: ${prefix}`);
  return { bucket: m[1], basePath: m[2] || '' };
}

async function importCsvBuffer(gcsFile, gzBuffer) {
  const run = db.beginObfIngestionRun({ run_type: 'baseline', source_file: gcsFile, notes: { format: 'csv_gz' } });
  const stream = Readable.from(gzBuffer).pipe(zlib.createGunzip());
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  let seen = 0;
  let upserted = 0;
  let failed = 0;
  let headers = null;

  for await (const line of rl) {
    if (!headers) {
      headers = String(line || '').split('\t');
      continue;
    }
    if (!line) continue;
    seen += 1;
    const cols = String(line).split('\t');
    const row = Object.create(null);
    for (let i = 0; i < headers.length; i++) row[headers[i]] = cols[i] || '';
    try {
      const doc = normalizeObfDocument(row);
      if (!doc) continue;
      const out = db.upsertObfIndexProduct({
        ...doc,
        source: 'baseline_csv',
        source_file: gcsFile
      });
      if (!out?.success) throw new Error(out?.error || 'upsert_failed');
      upserted += 1;
    } catch (e) {
      failed += 1;
      db.insertObfDlq({
        source_file: gcsFile,
        line_number: seen + 1,
        code: row.code || null,
        error: e.message || 'baseline_csv_ingest_failed',
        raw_payload: line.slice(0, 16000)
      });
    }
    if (seen % 10000 === 0) {
      console.log(`[obf-baseline] seen=${seen} upserted=${upserted} failed=${failed}`);
    }
  }

  db.finishObfIngestionRun({
    id: run.id,
    status: 'completed',
    rows_seen: seen,
    rows_upserted: upserted,
    rows_failed: failed,
    notes: { gcsFile, format: 'csv_gz' }
  });
  Metrics.increment('obf.baseline.rows_seen.count', seen);
  Metrics.increment('obf.baseline.rows_upserted.count', upserted);
  Metrics.increment('obf.baseline.rows_failed.count', failed);
}

async function main() {
  const args = parseArgs(process.argv);
  const storage = new Storage();
  const parsed = parseGcsPrefix(args.gcsPrefix);
  const gcsFile = `${parsed.basePath}/raw/full/en.openbeautyfacts.org.products.csv.gz`.replace(/^\/+/, '');
  const resp = await fetch(args.sourceUrl);
  if (!resp.ok) throw new Error(`baseline_http_${resp.status}`);
  const buf = Buffer.from(await resp.arrayBuffer());
  await storage.bucket(parsed.bucket).file(gcsFile).save(buf, { contentType: 'application/octet-stream' });
  console.log(`[obf-baseline] copied baseline to ${gcsFile}`);
  await importCsvBuffer(gcsFile, buf);
  const checkpoint = `${parsed.basePath}/checkpoints/last_applied_delta.txt`.replace(/^\/+/, '');
  await storage.bucket(parsed.bucket).file(checkpoint).save('', { contentType: 'text/plain; charset=utf-8' });
  console.log(`[obf-baseline] initialized checkpoint ${checkpoint}`);
}

main().catch((e) => {
  console.error('[obf-baseline] fatal:', e.message || e);
  process.exit(1);
});
