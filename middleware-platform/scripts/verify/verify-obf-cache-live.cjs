#!/usr/bin/env node
'use strict';
/* eslint-disable no-console */

const API_BASE = String(process.env.API_BASE_URL || 'http://127.0.0.1:4000').replace(/\/$/, '');
const BARCODE = String(process.env.BEAUTYFACTS_BARCODE || '3337875696548').trim();

async function hit(url) {
  const t0 = Date.now();
  const r = await fetch(url);
  const body = await r.json().catch(() => ({}));
  return { ms: Date.now() - t0, status: r.status, body };
}

async function main() {
  const live = await hit(`${API_BASE}/api/public/beautyfacts/${encodeURIComponent(BARCODE)}?force_live=1`);
  if (!live.body?.success || live.body?.data_source !== 'live_api') {
    throw new Error(`expected live_api on force_live=1, got status=${live.status} source=${live.body?.data_source}`);
  }
  const cached = await hit(`${API_BASE}/api/public/beautyfacts/${encodeURIComponent(BARCODE)}`);
  if (!cached.body?.success || cached.body?.data_source !== 'obf_index_cache') {
    throw new Error(`expected obf_index_cache on second call, got status=${cached.status} source=${cached.body?.data_source}`);
  }
  console.log(`[verify-obf-cache-live] PASS barcode=${BARCODE} live_ms=${live.ms} cache_ms=${cached.ms}`);
}

main().catch((e) => {
  console.error('[verify-obf-cache-live] FAIL', e.message || e);
  process.exit(1);
});

