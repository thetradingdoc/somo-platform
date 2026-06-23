#!/usr/bin/env node
'use strict';
/* eslint-disable no-console */

const API_BASE = String(process.env.API_BASE_URL || 'http://127.0.0.1:4000').replace(/\/$/, '');
const BARCODE = String(process.env.BEAUTYFACTS_BARCODE || '3337875696548').trim();

async function main() {
  const r = await fetch(`${API_BASE}/api/public/beautyfacts/${encodeURIComponent(BARCODE)}?simulate=timeout`);
  const body = await r.json().catch(() => ({}));
  if (r.status !== 502) throw new Error(`expected 502, got ${r.status}`);
  if (body?.error !== 'upstream_timeout') throw new Error(`expected upstream_timeout, got ${body?.error}`);
  const msg = String(body?.recovery?.message || '').toLowerCase();
  if (!msg.includes('retry')) throw new Error('expected retry guidance in timeout recovery message');
  console.log('[verify-obf-timeout-ux] PASS timeout contract and user messaging');
}

main().catch((e) => {
  console.error('[verify-obf-timeout-ux] FAIL', e.message || e);
  process.exit(1);
});

