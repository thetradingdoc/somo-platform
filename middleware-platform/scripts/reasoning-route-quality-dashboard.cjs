#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const Metrics = require('../services/metrics');

function buildRouteDashboard(all = {}) {
  const out = {};
  for (const [key, value] of Object.entries(all)) {
    const m = key.match(/^result_summary\.reasoning\.status\.([^.]+)\.route\.([^.]+)\.count$/);
    if (!m) continue;
    const status = m[1];
    const route = m[2];
    if (!out[route]) out[route] = { applied: 0, deferred: 0, unknown: 0, total: 0 };
    out[route][status] = Number(out[route][status] || 0) + Number(value || 0);
    out[route].total += Number(value || 0);
  }
  return out;
}

function main() {
  const metrics = Metrics.getAll();
  const dashboard = buildRouteDashboard(metrics);
  const payload = {
    generated_at: new Date().toISOString(),
    routes: dashboard,
    semantic_reject_total: Number(metrics['reasoning.semantic_reject.count'] || 0),
    unsupported_for_route_total: Number(metrics['reasoning.unsupported_for_route.count'] || 0)
  };
  const outDir = path.join(__dirname, '..', 'test-results');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `reasoning-route-quality-dashboard-${Date.now()}.json`);
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
  console.log(JSON.stringify(payload, null, 2));
  console.log(`[reasoning-route-quality-dashboard] wrote ${outPath}`);
}

main();
