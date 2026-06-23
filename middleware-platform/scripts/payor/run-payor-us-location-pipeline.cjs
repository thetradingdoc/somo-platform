#!/usr/bin/env node
'use strict';

/**
 * US location + plan search ingest pipeline (single DB target).
 *
 * Steps:
 * 1) preflight
 * 2) ingest crosswalk
 * 3) ingest service areas
 * 4) ingest landscape premiums
 * 5) ingest PBP benefits
 * 6) rebuild canonical geo tables from loaded crosswalk/service area
 * 7) post-step row counts + geo diagnostics gate
 * 8) smoke checks for ZIP + county
 */

const { spawnSync } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');
const node = process.execPath;

function fail(msg, code = 1) {
  console.error(`\n[payor-us-location-pipeline] ${msg}\n`);
  process.exit(code);
}

function run(label, cmd, args, env = {}) {
  console.error(`\n[payor-us-location-pipeline] === ${label} ===`);
  const r = spawnSync(cmd, args, {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, ...env }
  });
  if (r.error) fail(`${label}: ${r.error.message}`);
  if ((r.status ?? 1) !== 0) fail(`${label}: exit ${r.status}`, r.status ?? 1);
}

function main() {
  const requiredEnv = ['DB_PATH', 'CROSSWALK_FILE', 'SERVICE_AREA_CSV', 'LANDSCAPE_CSV', 'PBP_DIR'];
  for (const k of requiredEnv) {
    if (!String(process.env[k] || '').trim()) {
      fail(`Missing env var ${k}`);
    }
  }

  run('preflight', node, ['./scripts/payor/payor-us-location-preflight.cjs'], { SKIP_STARTUP_MIGRATIONS: '1' });
  run('crosswalk ingest', node, ['./scripts/payor/run-payor-zip-county-crosswalk-ingest.cjs'], { SKIP_STARTUP_MIGRATIONS: '1' });
  run('post-crosswalk preflight', node, ['./scripts/payor/payor-us-location-preflight.cjs'], { SKIP_STARTUP_MIGRATIONS: '1' });
  run('service area ingest', node, ['./scripts/payor/run-payor-service-area-ingest.cjs'], { SKIP_STARTUP_MIGRATIONS: '1' });
  run('post-service-area preflight', node, ['./scripts/payor/payor-us-location-preflight.cjs'], { SKIP_STARTUP_MIGRATIONS: '1' });
  run('landscape premium ingest', node, ['./scripts/payor/run-payor-landscape-premium-ingest.cjs'], { SKIP_STARTUP_MIGRATIONS: '1' });
  run('post-landscape preflight', node, ['./scripts/payor/payor-us-location-preflight.cjs'], { SKIP_STARTUP_MIGRATIONS: '1' });
  run('pbp benefits ingest', node, ['./scripts/payor/run-payor-pbp-benefits-ingest.cjs'], { SKIP_STARTUP_MIGRATIONS: '1' });
  const geoVersion = process.env.GEO_SOURCE_VERSION || `geo-us-location-${new Date().toISOString().slice(0, 10)}`;
  run('canonical geo rebuild', node, ['./scripts/build-canonical-geo-from-legacy.cjs'], {
    SKIP_STARTUP_MIGRATIONS: '1',
    GEO_SOURCE_VERSION: geoVersion
  });
  run('final preflight', node, ['./scripts/payor/payor-us-location-preflight.cjs'], { SKIP_STARTUP_MIGRATIONS: '1' });
  run('geo diagnostics readiness gate', node, ['./scripts/verify/verify-geo-diagnostics-post-ingest.cjs'], { SKIP_STARTUP_MIGRATIONS: '1' });

  run('smoke search ZIP 07205', 'curl', ['-sS', 'http://127.0.0.1:4000/api/public/plans/search?location_type=zip&zip=07205&needs=dental']);
  run('smoke search county Union NJ', 'curl', ['-sS', 'http://127.0.0.1:4000/api/public/plans/search?location_type=county&state=NJ&county=Union%20County&needs=dental']);
  run('meta row counts', 'curl', ['-sS', 'http://127.0.0.1:4000/api/public/plans/meta']);

  console.error('\n[payor-us-location-pipeline] complete\n');
}

main();
