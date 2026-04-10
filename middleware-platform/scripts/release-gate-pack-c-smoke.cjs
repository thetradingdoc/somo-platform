#!/usr/bin/env node
'use strict';
/* eslint-disable no-console */

const API_BASE = String(process.env.API_BASE || 'http://localhost:4000').replace(/\/$/, '');

function randDigits(len) {
  let out = '';
  while (out.length < len) out += String(Math.floor(Math.random() * 10));
  return out.slice(0, len);
}

async function hitBarcode(barcode) {
  const t0 = Date.now();
  const r = await fetch(`${API_BASE}/api/public/beautyfacts/${barcode}`);
  const body = await r.json().catch(() => ({}));
  return { ms: Date.now() - t0, status: r.status, body };
}

async function run() {
  const knownInput = String(process.env.SMOKE_KNOWN_CODES || '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
  const known = [];
  while (known.length < 20 && knownInput.length > 0) {
    known.push(knownInput[known.length % knownInput.length]);
  }
  const unknown = Array.from({ length: 20 }, () => randDigits(13));
  const malformed = ['abc', '12', '1234x', '', '!!!!', ...Array.from({ length: 5 }, () => randDigits(4))].slice(0, 10);
  const noBarcodeOcrManual = Array.from({ length: 5 }, (_, i) => `ocr_manual_case_${i + 1}`);

  const totals = {
    known: { n: 0, ok: 0, ms: [] },
    unknown: { n: 0, ok: 0, ms: [] },
    malformed: { n: 0, ok: 0, ms: [] }
  };

  for (const c of known) {
    const out = await hitBarcode(c);
    totals.known.n += 1;
    totals.known.ms.push(out.ms);
    if (out.status === 200 && out.body?.success) totals.known.ok += 1;
  }
  for (const c of unknown) {
    const out = await hitBarcode(c);
    totals.unknown.n += 1;
    totals.unknown.ms.push(out.ms);
    if (out.status === 404 || out.body?.error === 'upstream_404') totals.unknown.ok += 1;
  }
  for (const c of malformed) {
    const out = await hitBarcode(c);
    totals.malformed.n += 1;
    totals.malformed.ms.push(out.ms);
    if (out.status === 400) totals.malformed.ok += 1;
  }

  const avg = (arr) => (arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0);
  console.log('[release-gate-pack-c]');
  console.log(`known: ${totals.known.ok}/${totals.known.n} avg_ms=${avg(totals.known.ms)}`);
  console.log(`unknown: ${totals.unknown.ok}/${totals.unknown.n} avg_ms=${avg(totals.unknown.ms)}`);
  console.log(`malformed: ${totals.malformed.ok}/${totals.malformed.n} avg_ms=${avg(totals.malformed.ms)}`);
  console.log(`ocr_manual_cases: ${noBarcodeOcrManual.length} (validate manually in UI flow)`);
  if (known.length < 20) {
    console.log('known: insufficient provided codes for strict 20 known execution; provide SMOKE_KNOWN_CODES with enough valid barcodes');
  }
}

run().catch((e) => {
  console.error('[release-gate-pack-c] fatal:', e.message || e);
  process.exit(1);
});

