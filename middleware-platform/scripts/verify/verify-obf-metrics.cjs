#!/usr/bin/env node
'use strict';
/* eslint-disable no-console */

const API_BASE = String(process.env.API_BASE_URL || 'http://127.0.0.1:4000').replace(/\/$/, '');
const BARCODE = String(process.env.BEAUTYFACTS_BARCODE || '3337875696548').trim();

async function getJson(url) {
  const r = await fetch(url);
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`http_${r.status} ${url}`);
  return body;
}

async function main() {
  // Generate miss + live fallback + hit
  await getJson(`${API_BASE}/api/public/beautyfacts/${encodeURIComponent(BARCODE)}?force_live=1`);
  await getJson(`${API_BASE}/api/public/beautyfacts/${encodeURIComponent(BARCODE)}`);

  const metricsBody = await getJson(`${API_BASE}/api/admin/metrics`);
  const m = metricsBody?.metrics || {};
  const miss = Number(m['obf.index_cache.miss.count'] || 0);
  const hit = Number(m['obf.index_cache.hit.count'] || 0);
  const fallback = Number(m['obf.index_cache.fallback_to_live.count'] || 0);
  if (miss < 1 || hit < 1 || fallback < 1) {
    throw new Error(`expected miss/hit/fallback >= 1, got miss=${miss} hit=${hit} fallback=${fallback}`);
  }
  const fallbackRate = miss > 0 ? Number((fallback / miss).toFixed(4)) : 0;
  console.log(`[verify-obf-metrics] PASS miss=${miss} hit=${hit} fallback=${fallback} fallback_rate=${fallbackRate}`);
}

main().catch((e) => {
  console.error('[verify-obf-metrics] FAIL', e.message || e);
  process.exit(1);
});

