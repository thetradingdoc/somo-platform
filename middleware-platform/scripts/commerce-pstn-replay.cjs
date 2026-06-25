#!/usr/bin/env node
'use strict';

/**
 * Unified PSTN Replay fixture pipeline: generate → validate → validation report.
 *
 * Usage (repo root or middleware-platform):
 *   npm run commerce-pstn-replay
 */

const { execSync } = require('child_process');
const path = require('path');

const SCRIPTS = path.join(__dirname);

function run(cmd) {
  execSync(cmd, { stdio: 'inherit', cwd: path.join(__dirname, '..') });
}

function main() {
  run('node scripts/generate-commerce-pstn-replay-100.cjs');
  run('node scripts/generate-commerce-pstn-transcript-book.cjs');
  process.env.PSTN_WRITE_REPORT = '1';
  run('node scripts/validate-commerce-pstn-replay.cjs --report');
}

main();
