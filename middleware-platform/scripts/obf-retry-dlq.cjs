#!/usr/bin/env node
'use strict';
/* eslint-disable no-console */

const db = require('../database');
const { normalizeObfDocument } = require('./obf-normalize-record.cjs');
const Metrics = require('../services/metrics');

function parseArgs(argv) {
  const out = { limit: Number(process.env.OBF_DLQ_RETRY_LIMIT || 200) || 200 };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--limit') out.limit = Number(argv[++i] || out.limit) || out.limit;
  }
  return out;
}

function parsePayload(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (_) {
    return null;
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const rows = db.listObfDlq(args.limit);
  let retried = 0;
  let recovered = 0;
  let stillFailed = 0;
  for (const row of rows) {
    retried += 1;
    const obj = parsePayload(row.raw_payload);
    if (!obj) {
      stillFailed += 1;
      continue;
    }
    const doc = normalizeObfDocument(obj);
    if (!doc) {
      stillFailed += 1;
      continue;
    }
    const out = db.upsertObfIndexProduct({ ...doc, source: 'dlq_retry', source_file: row.source_file || 'dlq' });
    if (out?.success) {
      recovered += 1;
      db.deleteObfDlqById(row.id);
    } else {
      stillFailed += 1;
    }
  }
  Metrics.increment('obf.dlq.retry.attempted.count', retried);
  Metrics.increment('obf.dlq.retry.recovered.count', recovered);
  Metrics.increment('obf.dlq.retry.failed.count', stillFailed);
  console.log(`[obf-dlq-retry] attempted=${retried} recovered=${recovered} failed=${stillFailed}`);
}

main().catch((e) => {
  console.error('[obf-dlq-retry] fatal:', e.message || e);
  process.exit(1);
});

