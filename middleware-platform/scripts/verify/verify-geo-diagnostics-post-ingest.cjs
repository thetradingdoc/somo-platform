#!/usr/bin/env node
'use strict';

const BASE = String(process.env.PUBLIC_API_BASE_URL || 'http://127.0.0.1:4000').replace(/\/$/, '');

async function main() {
  const response = await fetch(`${BASE}/api/public/geo/health`, { headers: { accept: 'application/json' } });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  const d = data?.geo_diagnostics || {};

  const failures = [];
  if (response.status !== 200) failures.push(`geo_health_status_${response.status}`);
  if (!data?.geo_dataset_complete) failures.push('geo_dataset_incomplete');
  if (Number(d.distinct_zip_count || 0) <= 1) failures.push('distinct_zip_count_too_low');
  if (Number(d.distinct_county_count || 0) <= 1) failures.push('distinct_county_count_too_low');

  const payload = {
    event: 'verify_geo_diagnostics_post_ingest',
    base: BASE,
    status: response.status,
    geo_dataset_complete: Boolean(data?.geo_dataset_complete),
    geo_version: d.geo_version || data?.geo_version || null,
    distinct_zip_count: Number(d.distinct_zip_count || 0),
    distinct_county_count: Number(d.distinct_county_count || 0),
    states_with_counties_count: Number(d.states_with_counties_count || 0),
    failures
  };
  console.log(JSON.stringify(payload, null, 2));
  process.exit(failures.length ? 1 : 0);
}

main().catch((error) => {
  console.error(JSON.stringify({
    event: 'verify_geo_diagnostics_post_ingest',
    success: false,
    error: String(error?.message || error)
  }, null, 2));
  process.exit(1);
});
