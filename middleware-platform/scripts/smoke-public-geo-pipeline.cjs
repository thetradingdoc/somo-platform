#!/usr/bin/env node
/* eslint-disable no-console */
const BASE_URL = process.env.PUBLIC_API_BASE_URL || 'http://localhost:4000';
const ZIP_CASES = [
  '10469', '10001', '30301', '60601', '94105', '77001', '07205', '33101',
  '85001', '98101', '20001', '15222', '48201', '55401', '96813', '99501',
  '43215', '37203', '73102', '64106'
];

async function fetchJson(path) {
  const response = await fetch(`${BASE_URL}${path}`);
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (_) {
    data = { parse_error: true, raw: text.slice(0, 400) };
  }
  return { response, data };
}

async function run() {
  const summary = {
    base_url: BASE_URL,
    checks: {
      geo_health: null,
      geo_options: null,
      zip_resolution: [],
      zip_plan_search: []
    },
    failures: []
  };

  const geoHealth = await fetchJson('/api/public/geo/health');
  summary.checks.geo_health = {
    status: geoHealth.response.status,
    geo_dataset_complete: Boolean(geoHealth.data?.geo_dataset_complete),
    issues: geoHealth.data?.geo_diagnostics?.issues || []
  };
  if (!summary.checks.geo_health.geo_dataset_complete) {
    summary.failures.push('geo_health_incomplete');
  }

  const geoOptions = await fetchJson('/api/public/geo/options');
  const stateCount = Object.keys(geoOptions.data?.county_by_state || {}).length;
  summary.checks.geo_options = {
    status: geoOptions.response.status,
    zip_options_count: Array.isArray(geoOptions.data?.zip_options) ? geoOptions.data.zip_options.length : 0,
    county_options_count: Array.isArray(geoOptions.data?.county_options) ? geoOptions.data.county_options.length : 0,
    states_with_counties_count: stateCount,
    geo_dataset_complete: Boolean(geoOptions.data?.geo_dataset_complete),
    issues: geoOptions.data?.geo_diagnostics?.issues || []
  };
  if (summary.checks.geo_options.zip_options_count < 50) summary.failures.push('zip_options_too_low');
  if (summary.checks.geo_options.states_with_counties_count < 5) summary.failures.push('states_with_counties_too_low');

  for (const zip of ZIP_CASES) {
    const zipGeo = await fetchJson(`/api/public/geo/zip/${zip}`);
    const zipGeoRow = {
      zip,
      status: zipGeo.response.status,
      candidates_count: Array.isArray(zipGeo.data?.candidates) ? zipGeo.data.candidates.length : 0,
      resolved: Boolean(zipGeo.data?.resolved),
      ambiguous: Boolean(zipGeo.data?.ambiguous)
    };
    summary.checks.zip_resolution.push(zipGeoRow);
    if (zipGeoRow.candidates_count === 0) summary.failures.push(`zip_unresolved:${zip}`);

    const search = await fetchJson(`/api/public/plans/search?zip=${zip}&needs=dental,vision`);
    const searchRow = {
      zip,
      status: search.response.status,
      error: search.data?.error || null,
      count: Number(search.data?.count || 0),
      scope_used: search.data?.scope_used || null
    };
    summary.checks.zip_plan_search.push(searchRow);
    if (searchRow.status >= 400) summary.failures.push(`zip_search_http_error:${zip}:${searchRow.status}`);
  }

  summary.failures = Array.from(new Set(summary.failures));
  console.log(JSON.stringify(summary, null, 2));
  process.exit(summary.failures.length ? 1 : 0);
}

run().catch((error) => {
  console.error(JSON.stringify({ success: false, error: String(error?.message || error) }, null, 2));
  process.exit(1);
});
