#!/usr/bin/env node
'use strict';

/**
 * PSTN replay report CLI — re-run report generation from a saved JSON run file.
 * Usage: node scripts/somo-pstn-report.cjs --input tmp/commerce-pstn-run-*.json
 */

const fs = require('fs');
const path = require('path');
const { writeRunReport } = require('./lib/commerce-pstn-replay/report.cjs');

const REPO_ROOT = path.join(__dirname, '../..');

function main() {
  const input = process.argv[2];
  if (!input || input === '--help') {
    console.log('Usage: node scripts/somo-pstn-report.cjs <run-json-path> [--report=path]');
    process.exit(input ? 0 : 1);
  }

  const abs = path.isAbsolute(input) ? input : path.join(process.cwd(), input);
  const payload = JSON.parse(fs.readFileSync(abs, 'utf8'));
  const report =
    process.argv.find((a) => a.startsWith('--report='))?.slice(9) ||
    path.join(REPO_ROOT, 'docs/qa', `commerce-pstn-replay-RUN-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.md`);

  const out = writeRunReport(payload.results, { ...payload.opts, dryRun: payload.opts?.dryRun, report }, payload.runId, REPO_ROOT);
  console.log(`Wrote ${out}`);
}

main();
