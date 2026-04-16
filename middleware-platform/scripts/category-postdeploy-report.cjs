#!/usr/bin/env node
'use strict';
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const out = {
    baseline: path.join(__dirname, '..', 'tmp', 'category-phase2-baseline.locked.json'),
    candidate: path.join(__dirname, '..', 'tmp', 'category-route-observability.candidate.json'),
    output: path.join(__dirname, '..', 'tmp', 'category-postdeploy-report.json')
  };
  for (let i = 2; i < argv.length; i++) {
    const a = String(argv[i] || '');
    if (a === '--baseline') out.baseline = String(argv[++i] || out.baseline);
    else if (a === '--candidate') out.candidate = String(argv[++i] || out.candidate);
    else if (a === '--output') out.output = String(argv[++i] || out.output);
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv);
  const b = JSON.parse(fs.readFileSync(args.baseline, 'utf8'));
  const c = JSON.parse(fs.readFileSync(args.candidate, 'utf8'));
  const bUnknown = Number(b?.observability?.unknown_rate || 0);
  const cUnknown = Number(c?.unknown_rate || 0);
  const delta = Number((cUnknown - bUnknown).toFixed(6));
  const report = {
    generated_at: new Date().toISOString(),
    baseline_file: args.baseline,
    candidate_file: args.candidate,
    unknown_rate_baseline: bUnknown,
    unknown_rate_candidate: cUnknown,
    unknown_rate_delta: delta,
    route_distribution_candidate: c.byRoute || {},
    top_unknown_tags_candidate: c.top_unknown_tags || []
  };
  fs.mkdirSync(path.dirname(args.output), { recursive: true });
  fs.writeFileSync(args.output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`[category-postdeploy-report] wrote ${args.output}`);
  console.log(JSON.stringify(report, null, 2));
}

main();
