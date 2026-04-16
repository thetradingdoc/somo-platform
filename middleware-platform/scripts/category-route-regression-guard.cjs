#!/usr/bin/env node
'use strict';
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const out = {
    baseline: path.join(__dirname, '..', 'tmp', 'category-route-observability.baseline.json'),
    candidate: path.join(__dirname, '..', 'tmp', 'category-route-observability.json'),
    maxUnknownRateDelta: 0.02,
    maxRouteShift: 0.05
  };
  for (let i = 2; i < argv.length; i++) {
    const a = String(argv[i] || '');
    if (a === '--baseline') out.baseline = String(argv[++i] || out.baseline);
    else if (a === '--candidate') out.candidate = String(argv[++i] || out.candidate);
    else if (a === '--max-unknown-rate-delta') out.maxUnknownRateDelta = Number(argv[++i] || out.maxUnknownRateDelta);
    else if (a === '--max-route-shift') out.maxRouteShift = Number(argv[++i] || out.maxRouteShift);
  }
  return out;
}

function loadJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function ratio(map, key, total) {
  return total > 0 ? Number(((Number(map[key] || 0) / total)).toFixed(6)) : 0;
}

function main() {
  const args = parseArgs(process.argv);
  const b = loadJson(args.baseline);
  const c = loadJson(args.candidate);
  const errors = [];

  const unknownDelta = (c.unknown_rate || 0) - (b.unknown_rate || 0);
  if (unknownDelta > args.maxUnknownRateDelta) {
    errors.push(`unknown_rate_regression delta=${unknownDelta.toFixed(6)} limit=${args.maxUnknownRateDelta}`);
  }

  const routes = [...new Set([...Object.keys(b.byRoute || {}), ...Object.keys(c.byRoute || {})])];
  const shifts = routes.map((r) => {
    const br = ratio(b.byRoute || {}, r, b.total || 0);
    const cr = ratio(c.byRoute || {}, r, c.total || 0);
    return { route: r, baseline: br, candidate: cr, delta: Number((cr - br).toFixed(6)) };
  });
  for (const s of shifts) {
    if (Math.abs(s.delta) > args.maxRouteShift) {
      errors.push(`route_distribution_shift route=${s.route} delta=${s.delta} limit=${args.maxRouteShift}`);
    }
  }

  console.log(JSON.stringify({
    baseline: args.baseline,
    candidate: args.candidate,
    unknown_delta: unknownDelta,
    route_shifts: shifts
  }, null, 2));

  if (errors.length) {
    console.error('[category-route-regression-guard] FAIL');
    for (const e of errors) console.error('-', e);
    process.exitCode = 1;
    return;
  }
  console.log('[category-route-regression-guard] PASS');
}

main();
