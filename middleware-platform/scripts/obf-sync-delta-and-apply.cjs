#!/usr/bin/env node
'use strict';
/* eslint-disable no-console */

const zlib = require('zlib');
const readline = require('readline');
const { Readable } = require('stream');
const { Storage } = require('@google-cloud/storage');
const db = require('../database');
const Metrics = require('../services/metrics');
const { normalizeObfDocument } = require('./obf-normalize-record.cjs');

const DELTA_INDEX_URL = process.env.OBF_DELTA_INDEX_URL || 'https://static.openbeautyfacts.org/data/delta/index.txt';

function parseGcsPrefix(prefix) {
  const clean = String(prefix || '').replace(/\/$/, '');
  const m = clean.match(/^gs:\/\/([^/]+)(?:\/(.*))?$/);
  if (!m) throw new Error(`invalid_gcs_prefix: ${prefix}`);
  return { bucket: m[1], basePath: m[2] || '' };
}

function parseArgs(argv) {
  const out = {
    gcsPrefix: process.env.OBF_GCS_PREFIX || 'gs://skinandcare-media-staging/obf',
    limit: Number(process.env.OBF_DELTA_LIMIT || 0) || 0
  };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--gcs-prefix') out.gcsPrefix = String(argv[++i] || out.gcsPrefix);
    else if (argv[i] === '--limit') out.limit = Number(argv[++i] || out.limit) || 0;
  }
  return out;
}

async function readDeltaIndex() {
  const resp = await fetch(DELTA_INDEX_URL);
  if (!resp.ok) throw new Error(`delta_index_http_${resp.status}`);
  const raw = await resp.text();
  return raw
    .split('\n')
    .map((x) => x.trim())
    .filter((x) => x.endsWith('.json.gz'));
}

async function uploadText(storage, bucket, pathName, text) {
  await storage.bucket(bucket).file(pathName).save(text, { contentType: 'text/plain; charset=utf-8' });
}

async function uploadBuffer(storage, bucket, pathName, buf) {
  await storage.bucket(bucket).file(pathName).save(buf, { contentType: 'application/octet-stream' });
}

async function applyDeltaBuffer(filename, gzBuffer) {
  const run = db.beginObfIngestionRun({ run_type: 'delta', source_file: filename, notes: { filename } });
  let status = 'completed';
  let seen = 0;
  let upserted = 0;
  let failed = 0;
  try {
    const stream = Readable.from(gzBuffer).pipe(zlib.createGunzip());
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    for await (const line of rl) {
      const trimmed = String(line || '').trim();
      if (!trimmed) continue;
      seen += 1;
      try {
        const raw = JSON.parse(trimmed);
        const doc = normalizeObfDocument(raw);
        if (!doc) continue;
        const out = db.upsertObfIndexProduct({ ...doc, source: 'delta', source_file: filename });
        if (!out?.success) throw new Error(out?.error || 'upsert_failed');
        upserted += 1;
      } catch (e) {
        failed += 1;
        db.insertObfDlq({
          source_file: filename,
          line_number: seen,
          error: e.message || 'delta_row_failed',
          raw_payload: trimmed.slice(0, 16000)
        });
      }
    }
    db.recordObfDeltaApplied({ filename, rows_seen: seen, rows_upserted: upserted, rows_failed: failed });
    Metrics.increment('obf.delta.applied.count', 1);
    console.log(`[obf-delta] applied ${filename} seen=${seen} upserted=${upserted} failed=${failed}`);
  } catch (e) {
    status = 'failed';
    failed += 1;
    db.insertObfDlq({
      source_file: filename,
      error: e.message || 'delta_apply_failed',
      raw_payload: String(e.stack || e).slice(0, 16000)
    });
    Metrics.increment('obf.delta.failed.count', 1);
    console.error(`[obf-delta] failed ${filename}:`, e.message || e);
  } finally {
    db.finishObfIngestionRun({
      id: run?.id,
      status,
      rows_seen: seen,
      rows_upserted: upserted,
      rows_failed: failed,
      notes: { filename, status }
    });
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const storage = new Storage();
  const parsed = parseGcsPrefix(args.gcsPrefix);
  const gcsDeltaDir = `${parsed.basePath}/raw/delta`.replace(/^\/+/, '');
  const gcsMetaDir = `${parsed.basePath}/meta`.replace(/^\/+/, '');
  const files = await readDeltaIndex();
  if (!files.length) {
    console.log('[obf-delta] no files in index');
    return;
  }
  await uploadText(storage, parsed.bucket, `${gcsMetaDir}/index-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`, `${files.join('\n')}\n`);

  const applied = new Set(db.getAppliedObfDeltaFilenames());
  const pending = files.filter((f) => !applied.has(f));
  const selected = args.limit > 0 ? pending.slice(0, args.limit) : pending;
  console.log(`[obf-delta] index=${files.length} applied=${applied.size} pending=${pending.length} selected=${selected.length}`);
  Metrics.increment('obf.delta.pending.count', selected.length);

  for (const filename of selected) {
    const src = `https://static.openbeautyfacts.org/data/delta/${filename}`;
    const dst = `${gcsDeltaDir}/${filename}`;
    try {
      const resp = await fetch(src);
      if (!resp.ok) throw new Error(`delta_http_${resp.status}`);
      const buf = Buffer.from(await resp.arrayBuffer());
      await uploadBuffer(storage, parsed.bucket, dst, buf);
      await applyDeltaBuffer(filename, buf);
    } catch (e) {
      db.insertObfDlq({
        source_file: filename,
        error: e.message || 'delta_apply_failed',
        raw_payload: String(e.stack || e).slice(0, 16000)
      });
      Metrics.increment('obf.delta.failed.count', 1);
      console.error(`[obf-delta] failed ${filename}:`, e.message || e);
    }
  }
}

main().catch((e) => {
  console.error('[obf-delta] fatal:', e.message || e);
  process.exit(1);
});
