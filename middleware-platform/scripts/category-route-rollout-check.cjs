#!/usr/bin/env node
'use strict';
/* eslint-disable no-console */

const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

function run(cmd, args) {
  const out = spawnSync(cmd, args, { stdio: 'inherit' });
  if (out.status !== 0) process.exit(out.status || 1);
}

function main() {
  const tmpDir = path.join(__dirname, '..', 'tmp');
  const candidate = path.join(tmpDir, 'category-route-observability.candidate.json');
  const baseline = path.join(tmpDir, 'category-route-observability.baseline.json');
  fs.mkdirSync(tmpDir, { recursive: true });

  run('node', [path.join(__dirname, 'category-route-observability-report.cjs'), '--output', candidate]);
  if (!fs.existsSync(baseline)) {
    fs.copyFileSync(candidate, baseline);
    console.log(`[category-route-rollout-check] baseline initialized from candidate: ${baseline}`);
  }
  run('node', [
    path.join(__dirname, 'category-route-regression-guard.cjs'),
    '--baseline',
    baseline,
    '--candidate',
    candidate
  ]);
  run('node', [path.join(__dirname, 'category-route-golden-diff.cjs')]);
  console.log('[category-route-rollout-check] PASS');
}

main();
