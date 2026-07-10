#!/usr/bin/env node
'use strict';

/**
 * Phase 7.6 — Rollback drill timer (dry-run by default).
 *
 * Usage:
 *   node scripts/rollback-drill.cjs --dry-run
 *   node scripts/rollback-drill.cjs --execute   # runs rollback-gcp-release.sh (LIVE)
 */

const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const REPO = path.join(__dirname, '..', '..');
const MP = path.join(__dirname, '..');
const BUDGET_MS = 15 * 60 * 1000;

function elapsed(start) {
  return Date.now() - start;
}

function runStep(label, fn) {
  const t0 = Date.now();
  const ok = fn();
  const ms = Date.now() - t0;
  console.log(`${ok ? '✅' : '❌'} ${label} (${(ms / 1000).toFixed(1)}s)`);
  return { label, ok, ms };
}

function main() {
  const execute = process.argv.includes('--execute');
  const dryRun = !execute || process.argv.includes('--dry-run');
  const start = Date.now();
  const steps = [];

  console.log(`\n=== Rollback drill ${dryRun ? '(dry-run)' : '(LIVE)'} ===\n`);
  console.log(`Budget: ${BUDGET_MS / 60000} minutes\n`);

  steps.push(
    runStep('list revisions', () => {
      if (dryRun) {
        console.log('  (skip) gcloud run revisions list');
        return true;
      }
      const r = spawnSync('gcloud', ['run', 'revisions', 'list', '--limit', '3'], {
        stdio: 'inherit',
        env: process.env
      });
      return r.status === 0;
    })
  );

  steps.push(
    runStep('rollback traffic shift', () => {
      if (dryRun) {
        console.log('  (skip) bash scripts/rollback-gcp-release.sh');
        return true;
      }
      const r = spawnSync('bash', [path.join(REPO, 'scripts/rollback-gcp-release.sh')], {
        cwd: REPO,
        stdio: 'inherit',
        env: process.env
      });
      return r.status === 0;
    })
  );

  steps.push(
    runStep('prod routing smoke', () => {
      if (dryRun) {
        console.log('  (skip) verify:prod:routing-smoke');
        return true;
      }
      const r = spawnSync('npm', ['run', 'verify:prod:routing-smoke', '--prefix', 'middleware-platform'], {
        cwd: REPO,
        stdio: 'inherit',
        env: process.env
      });
      return r.status === 0;
    })
  );

  const totalMs = elapsed(start);
  const withinBudget = totalMs <= BUDGET_MS;
  const allOk = steps.every((s) => s.ok);

  const report = {
    mode: dryRun ? 'dry-run' : 'live',
    total_sec: Math.round(totalMs / 1000),
    budget_sec: BUDGET_MS / 1000,
    within_budget: withinBudget,
    pass: allOk && withinBudget,
    steps
  };

  const outDir = path.join(MP, 'test-results', 'rollback-drill');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `drill-${Date.now()}.json`);
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

  console.log('\n' + JSON.stringify(report, null, 2));
  console.log(`\nWrote ${outPath}`);

  if (!withinBudget) {
    console.error(`FAILED: drill exceeded ${BUDGET_MS / 60000} minute budget`);
  }

  process.exit(report.pass ? 0 : 1);
}

main();
