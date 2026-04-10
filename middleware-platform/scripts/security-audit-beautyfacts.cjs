#!/usr/bin/env node
'use strict';
/* eslint-disable no-console */

const API_BASE = String(process.env.API_BASE_URL || 'http://127.0.0.1:4000').replace(/\/$/, '');
const BARCODE = String(process.env.BEAUTYFACTS_BARCODE || '3337875696548').trim();

const forbiddenKeyRe = /(secret|token|password|api[_-]?key|private[_-]?key|client[_-]?secret|authorization)/i;
const forbiddenValueRe = /(sk_live_|sk_test_|AIza[0-9A-Za-z-_]{10,}|AKIA[0-9A-Z]{16}|-----BEGIN PRIVATE KEY-----)/i;

function flatten(obj, out = []) {
  if (obj == null) return out;
  if (Array.isArray(obj)) {
    for (const v of obj) flatten(v, out);
    return out;
  }
  if (typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      out.push({ key: String(k), value: v });
      flatten(v, out);
    }
  } else {
    out.push({ key: '', value: obj });
  }
  return out;
}

async function get(path) {
  const r = await fetch(`${API_BASE}${path}`);
  const body = await r.json().catch(() => ({}));
  return { status: r.status, body };
}

async function main() {
  const checks = await Promise.all([
    get(`/api/public/beautyfacts/${encodeURIComponent(BARCODE)}`),
    get(`/api/public/beautyfacts/12`),
    get(`/api/public/beautyfacts/${encodeURIComponent(BARCODE)}?simulate=timeout`)
  ]);
  for (const c of checks) {
    const pairs = flatten(c.body);
    for (const p of pairs) {
      if (forbiddenKeyRe.test(p.key)) {
        throw new Error(`forbidden key exposed in response: ${p.key}`);
      }
      if (typeof p.value === 'string' && forbiddenValueRe.test(p.value)) {
        throw new Error(`forbidden secret-like value exposed in response key=${p.key}`);
      }
    }
  }
  console.log('[security-audit-beautyfacts] PASS no obvious secret leakage in tested beautyfacts responses');
}

main().catch((e) => {
  console.error('[security-audit-beautyfacts] FAIL', e.message || e);
  process.exit(1);
});

