#!/usr/bin/env node
'use strict';
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const out = {
    local: path.join(__dirname, '..', 'tmp', 'category-route-observability.local.json'),
    representative: path.join(__dirname, '..', 'tmp', 'category-route-observability.representative.json'),
    output: path.join(__dirname, '..', 'tmp', 'category-route-guard-sensitivity.json')
  };
  for (let i = 2; i < argv.length; i++) {
    const a = String(argv[i] || '');
    if (a === '--local') out.local = String(argv[++i] || out.local);
    else if (a === '--representative') out.representative = String(argv[++i] || out.representative);
    else if (a === '--output') out.output = String(argv[++i] || out.output);
  }
  return out;
}

function delta(a, b) {
  return Number((Number(a || 0) - Number(b || 0)).toFixed(6));
}

function normalizeDist(byRoute = {}, total = 0) {
  const t = Number(total || 0) || 1;
  const out = {};
  for (const [k, v] of Object.entries(byRoute || {})) out[k] = Number((Number(v || 0) / t).toFixed(6));
  return out;
}

function main() {
  const args = parseArgs(process.argv);
  const local = JSON.parse(fs.readFileSync(args.local, 'utf8'));
  const rep = JSON.parse(fs.readFileSync(args.representative, 'utf8'));
  const localDist = normalizeDist(local.byRoute, local.total);
  const repDist = normalizeDist(rep.byRoute, rep.total);
  const routes = Array.from(new Set([...Object.keys(localDist), ...Object.keys(repDist)])).sort();
  const routeDeltas = routes.map((route) => ({
    route,
    local_rate: localDist[route] || 0,
    representative_rate: repDist[route] || 0,
    delta: delta(localDist[route], repDist[route])
  }));
  const out = {
    generated_at: new Date().toISOString(),
    local_report: path.resolve(args.local),
    representative_report: path.resolve(args.representative),
    unknown_rate_local: Number(local.unknown_rate || 0),
    unknown_rate_representative: Number(rep.unknown_rate || 0),
    unknown_rate_delta: delta(local.unknown_rate, rep.unknown_rate),
    route_deltas: routeDeltas
  };
  fs.mkdirSync(path.dirname(args.output), { recursive: true });
  fs.writeFileSync(args.output, `${JSON.stringify(out, null, 2)}\n`, 'utf8');
  console.log(`[category-guard-sensitivity] wrote ${args.output}`);
}

main();
