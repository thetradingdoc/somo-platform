#!/usr/bin/env node
'use strict';
/* eslint-disable no-console */

const API_BASE = String(process.env.API_BASE_URL || 'http://127.0.0.1:4000').replace(/\/$/, '');
const BARCODE = String(process.env.BEAUTYFACTS_BARCODE || '3337875696548').trim();
const REQUESTS = Number(process.env.RATE_LIMIT_BURST || 120);

async function main() {
  let got429 = 0;
  for (let i = 0; i < REQUESTS; i++) {
    const r = await fetch(`${API_BASE}/api/public/beautyfacts/${encodeURIComponent(BARCODE)}?force_live=1`);
    if (r.status === 429) got429 += 1;
  }
  if (got429 < 1) {
    throw new Error(`expected at least one 429 in burst=${REQUESTS}, got=${got429}`);
  }
  console.log(`[verify-beautyfacts-rate-limit] PASS burst=${REQUESTS} got429=${got429}`);
}

main().catch((e) => {
  console.error('[verify-beautyfacts-rate-limit] FAIL', e.message || e);
  process.exit(1);
});

