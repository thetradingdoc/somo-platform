#!/usr/bin/env node
'use strict';
/* eslint-disable no-console */

const { spawn } = require('child_process');

const API_BASE = String(process.env.API_BASE_URL || 'http://127.0.0.1:4000').replace(/\/$/, '');
const SLA_MS = Number(process.env.OBF_FRESHNESS_SLA_MS || 15000);
const BARCODE = String(process.env.OBF_FRESHNESS_TEST_BARCODE || '9988776655443').trim();

function importSyntheticDeltaRow() {
  return new Promise((resolve, reject) => {
    const child = spawn('node', ['./scripts/obf-import-stream.cjs', '--source-file', 'delta-freshness.jsonl', '--run-type', 'delta', '--source-label', 'delta'], {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe']
    });
    const row = JSON.stringify({
      code: BARCODE,
      product_name: 'Delta Freshness Product',
      ingredients_text: 'Water, Glycerin',
      categories_tags: ['en:cosmetic-product']
    });
    let err = '';
    child.stderr.on('data', (d) => { err += String(d || ''); });
    child.stdin.write(`${row}\n`);
    child.stdin.end();
    child.on('exit', (code) => {
      if (code !== 0) return reject(new Error(`import_exit_${code}: ${err}`));
      resolve();
    });
  });
}

async function main() {
  const t0 = Date.now();
  await importSyntheticDeltaRow();
  const r = await fetch(`${API_BASE}/api/public/beautyfacts/${encodeURIComponent(BARCODE)}`);
  const body = await r.json().catch(() => ({}));
  const elapsed = Date.now() - t0;
  if (!r.ok || !body?.success) throw new Error(`scan failed status=${r.status}`);
  if (elapsed > SLA_MS) throw new Error(`freshness SLA breached elapsed=${elapsed}ms sla=${SLA_MS}ms`);
  console.log(`[verify-delta-freshness-sla] PASS elapsed=${elapsed}ms sla=${SLA_MS}ms`);
}

main().catch((e) => {
  console.error('[verify-delta-freshness-sla] FAIL', e.message || e);
  process.exit(1);
});

