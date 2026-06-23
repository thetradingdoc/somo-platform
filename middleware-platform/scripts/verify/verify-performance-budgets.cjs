#!/usr/bin/env node
'use strict';
/* eslint-disable no-console */

const API_BASE = String(process.env.API_BASE_URL || 'http://127.0.0.1:4000').replace(/\/$/, '');
const BARCODE = String(process.env.BEAUTYFACTS_BARCODE || '3337875696548').trim();
const SESSION_ID = String(process.env.PERF_SESSION_ID || `perf_${Date.now()}`);
const SCAN_BUDGET_MS = Number(process.env.PERF_BUDGET_SCAN_TO_IDENTITY_MS || 2500);
const ANALYZE_BUDGET_MS = Number(process.env.PERF_BUDGET_ANALYZE_TO_VERDICT_MS || 5000);

async function timedFetch(url, init) {
  const t0 = Date.now();
  const r = await fetch(url, init);
  const body = await r.json().catch(() => ({}));
  return { ms: Date.now() - t0, status: r.status, body };
}

async function main() {
  const scan = await timedFetch(`${API_BASE}/api/public/beautyfacts/${encodeURIComponent(BARCODE)}`);
  if (!scan.body?.success) throw new Error(`scan failed status=${scan.status}`);
  if (scan.ms > SCAN_BUDGET_MS) throw new Error(`scan budget exceeded ${scan.ms}ms > ${SCAN_BUDGET_MS}ms`);

  const analyze = await timedFetch(`${API_BASE}/api/public/landing-assistant/turn`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      session_id: SESSION_ID,
      message: `Please analyze this scanned product quickly: ${scan.body?.product?.product_name || BARCODE}`,
      preferred_language: 'en',
      kelly_flow: 'skincare'
    })
  });
  if (!analyze.body?.success) throw new Error(`analyze failed status=${analyze.status}`);
  if (analyze.ms > ANALYZE_BUDGET_MS) throw new Error(`analyze budget exceeded ${analyze.ms}ms > ${ANALYZE_BUDGET_MS}ms`);

  console.log(`[verify-performance-budgets] PASS scan_ms=${scan.ms} analyze_ms=${analyze.ms}`);
}

main().catch((e) => {
  console.error('[verify-performance-budgets] FAIL', e.message || e);
  process.exit(1);
});

