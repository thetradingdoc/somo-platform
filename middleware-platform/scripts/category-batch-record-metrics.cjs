#!/usr/bin/env node
'use strict';
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const out = {
    batchId: `batch_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`,
    baseline: path.join(__dirname, '..', 'tmp', 'category-phase2-baseline.locked.json'),
    candidate: path.join(__dirname, '..', 'tmp', 'category-route-observability.candidate.json'),
    history: path.join(__dirname, '..', 'tmp', 'category-batch-metrics-history.json')
  };
  for (let i = 2; i < argv.length; i++) {
    const a = String(argv[i] || '');
    if (a === '--batch-id') out.batchId = String(argv[++i] || out.batchId);
    else if (a === '--baseline') out.baseline = String(argv[++i] || out.baseline);
    else if (a === '--candidate') out.candidate = String(argv[++i] || out.candidate);
    else if (a === '--history') out.history = String(argv[++i] || out.history);
  }
  return out;
}

function ratio(map, key, total) {
  return total > 0 ? Number(((Number(map[key] || 0) / total)).toFixed(6)) : 0;
}

function main() {
  const args = parseArgs(process.argv);
  const b = JSON.parse(fs.readFileSync(args.baseline, 'utf8'));
  const c = JSON.parse(fs.readFileSync(args.candidate, 'utf8'));
  const bUnknown = Number(b?.observability?.unknown_rate || 0);
  const cUnknown = Number(c?.unknown_rate || 0);
  const routes = [...new Set([...Object.keys(b?.observability?.byRoute || {}), ...Object.keys(c.byRoute || {})])];
  const shifts = routes.map((r) => {
    const br = ratio(b?.observability?.byRoute || {}, r, b?.observability?.total || 0);
    const cr = ratio(c.byRoute || {}, r, c.total || 0);
    return Math.abs(cr - br);
  });
  const item = {
    batch_id: args.batchId,
    recorded_at: new Date().toISOString(),
    baseline_unknown_rate: bUnknown,
    candidate_unknown_rate: cUnknown,
    unknown_drop_abs: Number((bUnknown - cUnknown).toFixed(6)),
    max_route_shift_abs: Number((Math.max(0, ...shifts)).toFixed(6))
  };
  let hist = [];
  if (fs.existsSync(args.history)) {
    try { hist = JSON.parse(fs.readFileSync(args.history, 'utf8')); } catch (_) {}
  }
  if (!Array.isArray(hist)) hist = [];
  hist.push(item);
  fs.mkdirSync(path.dirname(args.history), { recursive: true });
  fs.writeFileSync(args.history, `${JSON.stringify(hist, null, 2)}\n`, 'utf8');
  console.log(`[category-batch-record-metrics] appended ${args.history}`);
  console.log(JSON.stringify(item, null, 2));
}

main();
