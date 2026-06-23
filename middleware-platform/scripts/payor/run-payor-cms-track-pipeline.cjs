#!/usr/bin/env node
/**
 * CMS-authoritative payor track: migrate → tier-1 pull → NPPES bulk (Type 2) → directory → FHIR endpoints
 * → (optional seed dicts) → normalization → blocking → fuzzy → resolution decisions → canonicalization → reports.
 *
 * Does **not** run Office Ally or Inovalon importers (run those when exports exist).
 *
 * Usage (from middleware-platform/):
 *   npm run run:payor:cms-pipeline
 *   npm run run:payor:cms-pipeline -- --skip-migrate --skip-pull
 *   npm run run:payor:cms-pipeline -- --nppes-bulk-limit=10000
 *   npm run run:payor:cms-pipeline -- --skip-directory --skip-endpoints
 *
 * Env: DB_PATH, PAYOR_DATA_SOURCES_ROOT, NPPES_* overrides (see payor-data-sources.cjs), SQLITE_BUSY_TIMEOUT_MS.
 * Without vendor files, set PAYOR_READINESS_VENDOR_MODE=cms_only (or PAYOR_CMS_AUTHORITATIVE_TRACK_ONLY=1) for readiness.
 */

'use strict';

require('dotenv').config();
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
process.chdir(root);

const db = require('../../database');
const { logPayorIngestBanner } = require('./payor-sqlite-context');
logPayorIngestBanner({ label: 'payor-cms-pipeline', databaseModule: db });

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function argvFlag(name) {
  return process.argv.includes(`--${name}`);
}

function argvArg(name, fallback = null) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!hit) return fallback;
  return hit.slice(name.length + 3);
}

function skip(step) {
  return argvFlag(`skip-${step}`);
}

function run(label, command, args, envExtra = {}) {
  console.error(`\n[payor-cms-pipeline] === ${label} ===\n`);
  const r = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, ...envExtra },
    shell: false
  });
  if (r.error) {
    console.error(r.error);
    process.exit(1);
  }
  if (r.status !== 0) {
    console.error(`\n[payor-cms-pipeline] FAILED: ${label} (exit ${r.status})\n`);
    process.exit(r.status ?? 1);
  }
}

function npmRun(script, extraArgs = [], envExtra = {}) {
  const args = ['run', script, '--', ...extraArgs];
  run(`npm run ${script}`, npmCmd, args, envExtra);
}

const skipStartup = { SKIP_STARTUP_MIGRATIONS: process.env.SKIP_STARTUP_MIGRATIONS || '1' };

const nppesBulkLimit = argvArg('nppes-bulk-limit', '');
const normLimit = argvArg('norm-limit', '5000');
const normSource = argvArg('norm-source', 'nppes_bulk');

if (!skip('migrate')) {
  npmRun('migrate');
}

if (!skip('pull')) {
  npmRun('pull:payor:tier1', [], skipStartup);
}

if (!skip('nppes-bulk')) {
  const bulkArgs = [];
  if (nppesBulkLimit !== '' && nppesBulkLimit != null) {
    bulkArgs.push(`--limit=${nppesBulkLimit}`);
  }
  npmRun('import:payor:nppes-bulk', bulkArgs, skipStartup);
}

if (!skip('directory')) {
  npmRun('import:nppes-directory', [], skipStartup);
}

if (!skip('endpoints')) {
  npmRun('import:nppes-endpoints', [], skipStartup);
}

if (!skip('seed-dict')) {
  npmRun('seed:payor:normalization', [], skipStartup);
}

if (!skip('normalize')) {
  npmRun('run:payor:normalization', [
    '--until-done',
    `--source=${normSource}`,
    `--limit=${normLimit}`
  ], skipStartup);
}

if (!skip('blocking')) {
  npmRun('run:payor:blocking', [], skipStartup);
}

if (!skip('fuzzy')) {
  npmRun('run:payor:fuzzy-match', [], skipStartup);
}

if (!skip('resolution')) {
  npmRun('run:payor:resolution-decisions', [], skipStartup);
}

if (!skip('canonicalization')) {
  npmRun('run:payor:canonicalization', [], skipStartup);
}

if (!skip('readiness')) {
  npmRun('report:payor:readiness:step0-2', [], skipStartup);
}

if (!skip('ops')) {
  npmRun('report:payor:ops', [], skipStartup);
}

console.error('\n[payor-cms-pipeline] done (Office Ally / Inovalon not in this chain — run `npm run import:payor:office-ally` / `import:payor:inovalon` when ready).\n');
