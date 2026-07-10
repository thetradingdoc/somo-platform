#!/usr/bin/env node
'use strict';

const path = require('path');
const fs = require('fs');
const { readHistory } = require('../e2e/helpers/portal-e2e-history.cjs');
const { PARITY_FILE, RESULTS_DIR } = require('../e2e/helpers/portal-e2e-config.cjs');

function log(msg) {
  console.log(`[parity-report] ${msg}`);
}

function loadJson(p) {
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function main() {
  log('=== Parity table builder ===');
  const resultsDir = path.join(__dirname, '..', 'test-results', 'portal-e2e');
  const runs = fs.existsSync(resultsDir)
    ? fs.readdirSync(resultsDir).filter((f) => f.startsWith('run-') && f.endsWith('.json'))
    : [];

  const byEnv = { local: null, staging: null, production: null };
  for (const f of runs) {
    const data = loadJson(path.join(resultsDir, f));
    if (data?.env) byEnv[data.env] = data;
  }

  const history = readHistory().slice(-20);
  const rows = [];

  const p0Controls = [
    'api_health',
    'landing',
    'auth',
    'onboarding',
    'today_dashboard',
    'kelly_pause_transfer',
    'session_auth',
    'kill_switch',
    'logout_login_redirect'
  ];

  for (const control of p0Controls) {
    const row = { control, tier: 'P0', local: null, staging: null, production: null };
    for (const env of ['local', 'staging', 'production']) {
      const run = byEnv[env];
      if (!run?.p0_results) continue;
      const hit = run.p0_results.find((r) => r.id === control);
      row[env] = hit ? hit.status : 'not_run';
    }
    rows.push(row);
  }

  const prodOnlyFails = rows.filter((r) => r.production === 'fail' && r.local !== 'fail' && r.staging !== 'fail');
  const universalFails = rows.filter(
    (r) => r.production === 'fail' && (r.local === 'fail' || r.staging === 'fail')
  );

  log('\nP0 parity:');
  console.table(rows);

  log(`\nProd-only P0 failures (deploy gap): ${prodOnlyFails.length}`);
  prodOnlyFails.forEach((r) => log(`  ${r.control}`));
  log(`Universal P0 failures (product bug): ${universalFails.length}`);
  universalFails.forEach((r) => log(`  ${r.control}`));

  const report = {
    generated_at: new Date().toISOString(),
    rows,
    prod_only_failures: prodOnlyFails.map((r) => r.control),
    universal_failures: universalFails.map((r) => r.control),
    recent_history: history
  };

  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  fs.writeFileSync(PARITY_FILE, JSON.stringify(report, null, 2));
  log(`wrote ${PARITY_FILE}`);

  if (prodOnlyFails.length && process.argv.includes('--strict')) process.exit(1);
}

main();
