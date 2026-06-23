#!/usr/bin/env node
'use strict';
/* eslint-disable no-console */

const { spawn } = require('child_process');

const API_BASE = String(process.env.API_BASE_URL || 'http://127.0.0.1:4000').replace(/\/$/, '');
const BARCODE = String(process.env.BEAUTYFACTS_BARCODE || '3337875696548').trim();

function runDeltaWithOutage() {
  return new Promise((resolve) => {
    const child = spawn('node', ['./scripts/obf-sync-delta-and-apply.cjs', '--limit', '1'], {
      cwd: process.cwd(),
      env: { ...process.env, OBF_DELTA_INDEX_URL: 'https://static.openbeautyfacts.org/data/delta/does-not-exist.txt' }
    });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += String(d || ''); });
    child.on('exit', (code) => resolve({ code, stderr }));
  });
}

async function main() {
  const out = await runDeltaWithOutage();
  if (out.code === 0) throw new Error('expected delta outage to fail');
  const live = await fetch(`${API_BASE}/api/public/beautyfacts/${encodeURIComponent(BARCODE)}?force_live=1`);
  const body = await live.json().catch(() => ({}));
  if (!live.ok || !body?.success) {
    throw new Error(`live fallback unhealthy during delta outage status=${live.status}`);
  }
  console.log('[verify-delta-outage-live-fallback] PASS delta outage failed while live lookup remained healthy');
}

main().catch((e) => {
  console.error('[verify-delta-outage-live-fallback] FAIL', e.message || e);
  process.exit(1);
});

