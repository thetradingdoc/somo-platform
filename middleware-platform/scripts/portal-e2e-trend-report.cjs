#!/usr/bin/env node
'use strict';

const path = require('path');
const {
  readHistory,
  p0PassRate,
  p1CoverageDebt,
  intermittentFailures
} = require('../e2e/helpers/portal-e2e-history.cjs');
const { P1_COVERAGE_WINDOW, RESULTS_DIR } = require('../e2e/helpers/portal-e2e-config.cjs');
const fs = require('fs');

function log(msg) {
  console.log(`[portal-e2e-trend] ${msg}`);
}

function main() {
  const entries = readHistory();
  log(`=== Portal E2E trend report ===`);
  log(`total runs in history: ${entries.length}`);

  const r7 = p0PassRate(entries, 7);
  const r30 = p0PassRate(entries, 30);
  log(`P0 pass rate (7d):  ${r7.passed}/${r7.total} = ${r7.rate != null ? (r7.rate * 100).toFixed(1) + '%' : 'n/a'}`);
  log(`P0 pass rate (30d): ${r30.passed}/${r30.total} = ${r30.rate != null ? (r30.rate * 100).toFixed(1) + '%' : 'n/a'}`);

  const r14 = p0PassRate(
    entries.filter((e) => e.env === 'production'),
    14
  );
  const gateOk = r14.rate != null && r14.rate >= 0.95;
  log(`Prod P0 pass rate (14d): ${r14.passed}/${r14.total} = ${r14.rate != null ? (r14.rate * 100).toFixed(1) + '%' : 'n/a'} ${gateOk ? 'OK' : 'BELOW 95% TARGET'}`);

  const intermittent = intermittentFailures(entries, 30);
  if (intermittent.length) {
    log('Intermittent P0 failures (≥2 in 30d):');
    intermittent.forEach((x) => log(`  ${x.control}: ${x.count}x`));
  } else {
    log('No intermittent P0 failures detected');
  }

  const p1 = p1CoverageDebt(entries, P1_COVERAGE_WINDOW);
  log(`P1 coverage (last ${p1.window} prod reuse runs): ${p1.covered}/${p1.total}`);
  if (p1.missing.length) {
    log(`P1 not covered: ${p1.missing.join(', ')}`);
  }

  const report = {
    generated_at: new Date().toISOString(),
    total_runs: entries.length,
    p0_7d: r7,
    p0_30d: r30,
    prod_p0_14d: r14,
    prod_p0_gate_ok: gateOk,
    intermittent,
    p1_coverage: p1
  };

  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const out = path.join(RESULTS_DIR, 'trend-report.json');
  fs.writeFileSync(out, JSON.stringify(report, null, 2));
  log(`wrote ${out}`);

  if (process.argv.includes('--strict') && !gateOk && r14.total >= 14) {
    process.exit(1);
  }
}

main();
