#!/usr/bin/env node
'use strict';
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const out = {
    report: path.join(__dirname, '..', 'tmp', 'category-route-observability.json'),
    output: path.join(__dirname, '..', 'tmp', 'category-route-guard-baseline.json'),
    sampleSource: 'local_db_sample',
    sampleSize: 0,
    mapVersion: 'unknown'
  };
  for (let i = 2; i < argv.length; i++) {
    const a = String(argv[i] || '');
    if (a === '--report') out.report = String(argv[++i] || out.report);
    else if (a === '--output') out.output = String(argv[++i] || out.output);
    else if (a === '--sample-source') out.sampleSource = String(argv[++i] || out.sampleSource);
    else if (a === '--sample-size') out.sampleSize = Number(argv[++i] || 0) || 0;
    else if (a === '--map-version') out.mapVersion = String(argv[++i] || out.mapVersion);
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv);
  const report = JSON.parse(fs.readFileSync(args.report, 'utf8'));
  const baseline = {
    generated_at: new Date().toISOString(),
    sample_source: args.sampleSource,
    sample_size: args.sampleSize || Number(report.total || 0),
    map_version: args.mapVersion,
    observability_report: path.resolve(args.report),
    metrics: {
      total: Number(report.total || 0),
      unknown: Number(report.unknown || 0),
      unknown_rate: Number(report.unknown_rate || 0),
      by_route: report.byRoute || {}
    }
  };
  fs.mkdirSync(path.dirname(args.output), { recursive: true });
  fs.writeFileSync(args.output, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8');
  console.log(`[category-guard-baseline] wrote ${args.output}`);
}

main();
