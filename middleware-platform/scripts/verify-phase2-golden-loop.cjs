#!/usr/bin/env node
'use strict';

/**
 * Dental golden loop structural gate (LO-P0-1) — chains sandbox scripts without Stedi prod.
 */

const { spawnSync } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function run(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', env: process.env });
  return { ok: r.status === 0, out: (r.stdout || '') + (r.stderr || '') };
}

function main() {
  const checks = [];
  let pass = true;

  const billing = run('node', ['scripts/verify-phase2-billing.cjs']);
  checks.push({ name: 'verify-phase2-billing', ok: billing.ok });
  if (!billing.ok) pass = false;

  const sandbox = run('node', ['scripts/verify-phase2-dental-copay.cjs']);
  checks.push({ name: 'verify-phase2-dental-copay', ok: sandbox.ok });
  if (!sandbox.ok) pass = false;

  console.log(JSON.stringify({ pass, checks }, null, 2));
  process.exit(pass ? 0 : 1);
}

main();
