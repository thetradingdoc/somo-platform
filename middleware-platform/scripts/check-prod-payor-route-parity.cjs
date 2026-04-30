#!/usr/bin/env node
'use strict';

const PROD_BASE = String(process.env.PROD_API_BASE || 'https://api.myskinandcare.com').replace(/\/$/, '');

async function fetchJson(url) {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (_) {
    data = { raw: text.slice(0, 500) };
  }
  return { status: res.status, data };
}

async function main() {
  const checks = {};
  checks.health = await fetchJson(`${PROD_BASE}/health`);
  checks.api = await fetchJson(`${PROD_BASE}/api`);
  checks.plansSearch = await fetchJson(`${PROD_BASE}/api/public/plans/search?location_type=zip&zip=07205&needs=dental`);
  checks.plansMeta = await fetchJson(`${PROD_BASE}/api/public/plans/meta`);

  const issues = [];
  if (checks.health.status >= 400) issues.push('health_unreachable');
  if (checks.api.status >= 400) issues.push('api_unreachable');
  if (checks.plansSearch.status === 404) issues.push('plans_search_route_missing');
  if (checks.plansMeta.status === 404) issues.push('plans_meta_route_missing');
  if (String(checks.plansSearch?.data?.message || '').includes('no such column')) issues.push('schema_drift_no_such_column');

  console.log(JSON.stringify({
    event: 'prod_payor_route_parity',
    base: PROD_BASE,
    checks,
    issues
  }, null, 2));

  process.exit(issues.length ? 1 : 0);
}

main().catch((e) => {
  console.error(JSON.stringify({ success: false, error: e.message }, null, 2));
  process.exit(1);
});
