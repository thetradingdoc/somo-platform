#!/usr/bin/env node
'use strict';
/* eslint-disable no-console */

const { spawn } = require('child_process');

const API_BASE = String(process.env.API_BASE_URL || 'http://127.0.0.1:4000').replace(/\/$/, '');
const ROOT = `${process.cwd()}`;

async function getJson(url) {
  const r = await fetch(url);
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`http_${r.status}`);
  return body;
}

function runImportWithSample() {
  return new Promise((resolve, reject) => {
    const child = spawn('node', ['./scripts/obf-import-stream.cjs', '--source-file', 'sample.jsonl', '--run-type', 'baseline', '--source-label', 'sample'], {
      cwd: ROOT,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let err = '';
    child.stderr.on('data', (d) => { err += String(d || ''); });
    const lines = [
      JSON.stringify({ code: '12345678', product_name: 'Metric Product', ingredients_text: 'Water' }),
      '{ malformed json'
    ].join('\n');
    child.stdin.write(lines);
    child.stdin.end();
    child.on('exit', (code) => {
      if (code !== 0) return reject(new Error(`import_exit_${code}: ${err}`));
      resolve();
    });
  });
}

async function main() {
  await runImportWithSample();
  const body = await getJson(`${API_BASE}/api/admin/metrics`);
  const m = body?.metrics || {};
  const seen = Number(m['obf.ingestion.rows_seen.count'] || 0);
  const upserted = Number(m['obf.ingestion.rows_upserted.count'] || 0);
  const failed = Number(m['obf.ingestion.rows_failed.count'] || 0);
  if (seen < 1 || upserted < 1 || failed < 1) {
    throw new Error(`expected ingestion counters >=1 got seen=${seen} upserted=${upserted} failed=${failed}`);
  }
  console.log(`[verify-obf-ingestion-metrics] PASS seen=${seen} upserted=${upserted} failed=${failed}`);
}

main().catch((e) => {
  console.error('[verify-obf-ingestion-metrics] FAIL', e.message || e);
  process.exit(1);
});

