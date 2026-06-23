#!/usr/bin/env node
'use strict';
/* eslint-disable no-console */

const API_BASE = String(process.env.API_BASE_URL || 'http://127.0.0.1:4000').replace(/\/$/, '');
const BARCODE = String(process.env.BEAUTYFACTS_BARCODE || '3337875696548').trim();

async function main() {
  const timeoutResp = await fetch(`${API_BASE}/api/public/beautyfacts/${encodeURIComponent(BARCODE)}?simulate=timeout`);
  const timeoutBody = await timeoutResp.json().catch(() => ({}));
  if (timeoutResp.status !== 502) throw new Error(`expected 502 for timeout simulation, got ${timeoutResp.status}`);
  const recovery = String(timeoutBody?.recovery?.message || '').toLowerCase();
  if (!recovery.includes('retry')) throw new Error('missing retry guidance in low-network response');
  if (!recovery.includes('ingredients')) throw new Error('missing manual ingredient fallback guidance');

  // Retry path should still work.
  const retryResp = await fetch(`${API_BASE}/api/public/beautyfacts/${encodeURIComponent(BARCODE)}?force_live=1`);
  const retryBody = await retryResp.json().catch(() => ({}));
  if (!retryResp.ok || !retryBody?.success) throw new Error(`retry request failed status=${retryResp.status}`);

  console.log('[verify-low-network-retry-ux] PASS timeout guidance + successful retry');
}

main().catch((e) => {
  console.error('[verify-low-network-retry-ux] FAIL', e.message || e);
  process.exit(1);
});

