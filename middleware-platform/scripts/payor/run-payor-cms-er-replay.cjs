#!/usr/bin/env node
/**
 * Re-run payor ER steps only (no migrate / no tier-1 / no NPPES file imports).
 * normalize → blocking → fuzzy → resolution → canonicalization → readiness + ops reports.
 *
 *   npm run run:payor:cms-er-replay
 *   npm run run:payor:cms-er-replay -- --skip-readiness --norm-limit=8000
 */

'use strict';

require('dotenv').config();
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
process.chdir(root);

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
  console.error(`\n[payor-cms-er-replay] === ${label} ===\n`);
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
    console.error(`\n[payor-cms-er-replay] FAILED: ${label} (exit ${r.status})\n`);
    process.exit(r.status ?? 1);
  }
}

function npmRun(script, extraArgs = []) {
  run(`npm run ${script}`, npmCmd, ['run', script, '--', ...extraArgs], {
    SKIP_STARTUP_MIGRATIONS: process.env.SKIP_STARTUP_MIGRATIONS || '1'
  });
}

const db = require('../../database');
const { logPayorIngestBanner } = require('./payor-sqlite-context');
logPayorIngestBanner({ label: 'payor-cms-er-replay', databaseModule: db });

const normLimit = argvArg('norm-limit', '5000');
const normSource = argvArg('norm-source', 'nppes_bulk');

if (!skip('normalize')) {
  npmRun('run:payor:normalization', ['--until-done', `--source=${normSource}`, `--limit=${normLimit}`]);
}
if (!skip('blocking')) npmRun('run:payor:blocking');
if (!skip('fuzzy')) npmRun('run:payor:fuzzy-match');
if (!skip('resolution')) npmRun('run:payor:resolution-decisions');
if (!skip('canonicalization')) npmRun('run:payor:canonicalization');
if (!skip('readiness')) npmRun('report:payor:readiness:step0-2');
if (!skip('ops')) npmRun('report:payor:ops');

console.error('\n[payor-cms-er-replay] done.\n');
