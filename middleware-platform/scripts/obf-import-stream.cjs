#!/usr/bin/env node
'use strict';
/* eslint-disable no-console */

const readline = require('readline');
const crypto = require('crypto');
const db = require('../database');
const Metrics = require('../services/metrics');
const { normalizeObfDocument } = require('./obf-normalize-record.cjs');

function parseArgs(argv) {
  const out = {
    sourceFile: 'stdin',
    runType: 'baseline',
    sourceLabel: 'baseline'
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--source-file') out.sourceFile = String(argv[++i] || out.sourceFile);
    else if (a === '--run-type') out.runType = String(argv[++i] || out.runType);
    else if (a === '--source-label') out.sourceLabel = String(argv[++i] || out.sourceLabel);
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  const run = db.beginObfIngestionRun({
    run_type: args.runType,
    source_file: args.sourceFile,
    notes: { source_label: args.sourceLabel }
  });
  if (!run?.success) throw new Error(run?.error || 'failed_to_start_run');
  const runId = run.id;

  let seen = 0;
  let upserted = 0;
  let failed = 0;
  let lineNo = 0;

  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of rl) {
    lineNo += 1;
    const trimmed = String(line || '').trim();
    if (!trimmed) continue;
    seen += 1;
    try {
      const obj = JSON.parse(trimmed);
      const norm = normalizeObfDocument(obj);
      if (!norm) continue;
      const out = db.upsertObfIndexProduct({
        ...norm,
        source: args.sourceLabel,
        source_file: args.sourceFile
      });
      if (!out?.success) throw new Error(out?.error || 'upsert_failed');
      upserted += 1;
    } catch (e) {
      failed += 1;
      db.insertObfDlq({
        id: `obf_dlq:${crypto.randomUUID()}`,
        source_file: args.sourceFile,
        line_number: lineNo,
        error: e.message || 'parse_or_upsert_failed',
        raw_payload: trimmed.slice(0, 16000)
      });
    }
    if (seen % 5000 === 0) {
      console.log(`[obf-import] run=${runId} seen=${seen} upserted=${upserted} failed=${failed}`);
    }
  }

  db.finishObfIngestionRun({
    id: runId,
    status: failed > 0 ? 'completed' : 'completed',
    rows_seen: seen,
    rows_upserted: upserted,
    rows_failed: failed,
    notes: { source_label: args.sourceLabel }
  });
  Metrics.increment('obf.ingestion.rows_seen.count', seen);
  Metrics.increment('obf.ingestion.rows_upserted.count', upserted);
  Metrics.increment('obf.ingestion.rows_failed.count', failed);
  console.log(`[obf-import] done run=${runId} seen=${seen} upserted=${upserted} failed=${failed}`);
}

main().catch((e) => {
  console.error('[obf-import] fatal:', e.message || e);
  process.exit(1);
});
