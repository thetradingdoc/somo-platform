#!/usr/bin/env node
'use strict';

/**
 * CR-025 — Run Spanish booking sandbox 3× and require 14/14 TCR each run.
 *
 * Usage: npm run sandbox:spanish-green
 */

const { spawnSync } = require('child_process');
const path = require('path');

const RUNS = parseInt(process.env.SPANISH_GREEN_RUNS || '3', 10);
const REQUIRED_TCR = parseInt(process.env.SPANISH_GREEN_TCR || '14', 10);

function runOnce(i) {
  const r = spawnSync(
    process.execPath,
    ['scripts/rails-conversation-sandbox.cjs', '--scenario', 'spanish_booking', '--tcr'],
    {
      cwd: path.join(__dirname, '..'),
      encoding: 'utf8',
      env: { ...process.env, SKIP_STARTUP_MIGRATIONS: '1' }
    }
  );
  const out = `${r.stdout || ''}\n${r.stderr || ''}`;
  const match = out.match(/TCR[:\s]+(\d+)\s*\/\s*(\d+)/i) || out.match(/(\d+)\s*\/\s*(\d+)\s*TCR/i);
  const score = match ? parseInt(match[1], 10) : 0;
  const total = match ? parseInt(match[2], 10) : REQUIRED_TCR;
  const pass = r.status === 0 && score >= REQUIRED_TCR && total >= REQUIRED_TCR;
  console.log(JSON.stringify({ run: i + 1, score, total, pass, exit: r.status }));
  if (!pass && r.status !== 0) console.error(out.slice(-2000));
  return pass;
}

function main() {
  let ok = 0;
  for (let i = 0; i < RUNS; i++) {
    if (runOnce(i)) ok++;
    else break;
  }
  const pass = ok === RUNS;
  console.log(JSON.stringify({ runs_required: RUNS, runs_passed: ok, tcr_required: REQUIRED_TCR, pass }, null, 2));
  process.exit(pass ? 0 : 1);
}

main();
