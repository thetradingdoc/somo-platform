#!/usr/bin/env node
'use strict';

/** Offline navigation acceptance bundle (P5-S2) */
const { spawnSync } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const steps = [
  ['npm', ['run', 'test:navigation:contracts']],
  ['npm', ['run', 'navigation:p1s1-local-gate']],
  ['node', ['scripts/navigation-preflight.cjs']]
];

let pass = true;
for (const [cmd, args] of steps) {
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit', env: { ...process.env } });
  if (r.status !== 0) pass = false;
}

console.log(JSON.stringify({ pass, acceptance: 'navigation:acceptance', steps: steps.length }, null, 2));
process.exit(pass ? 0 : 1);
