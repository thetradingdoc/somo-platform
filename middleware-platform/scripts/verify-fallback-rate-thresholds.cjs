#!/usr/bin/env node
'use strict';
/* eslint-disable no-console */

const API_BASE = String(process.env.API_BASE_URL || 'http://127.0.0.1:4000').replace(/\/$/, '');

async function main() {
  const r = await fetch(`${API_BASE}/api/admin/metrics`);
  const body = await r.json().catch(() => ({}));
  if (!r.ok || !body?.success) throw new Error(`metrics endpoint failed status=${r.status}`);
  const obf = body?.obf || {};
  if (typeof obf.fallback_rate !== 'number') throw new Error('missing obf.fallback_rate');
  if (!obf.thresholds || typeof obf.thresholds.warn !== 'number' || typeof obf.thresholds.critical !== 'number') {
    throw new Error('missing OBF fallback thresholds');
  }
  if (!['ok', 'warning', 'critical'].includes(String(obf.status || ''))) {
    throw new Error(`invalid obf.status=${obf.status}`);
  }
  console.log(
    `[verify-fallback-rate-thresholds] PASS rate=${obf.fallback_rate} warn=${obf.thresholds.warn} critical=${obf.thresholds.critical} status=${obf.status}`
  );
}

main().catch((e) => {
  console.error('[verify-fallback-rate-thresholds] FAIL', e.message || e);
  process.exit(1);
});

