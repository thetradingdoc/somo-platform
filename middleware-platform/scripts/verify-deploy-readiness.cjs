#!/usr/bin/env node
'use strict';

/**
 * Pre-deploy readiness — ci:gate (when defined) + verify:front-desk-pilot.
 */

const { spawnSync } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const pkg = require(path.join(ROOT, 'package.json'));

function run(label, npmScript) {
  console.log(`\n── ${label} ──`);
  const r = spawnSync('npm', ['run', npmScript], { cwd: ROOT, stdio: 'inherit', env: process.env });
  return r.status === 0;
}

function main() {
  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║  Front Desk Deploy Readiness                     ║');
  console.log('╚══════════════════════════════════════════════════╝\n');

  let pass = true;
  if (pkg.scripts && pkg.scripts['ci:gate']) {
    pass = run('ci:gate', 'ci:gate') && pass;
  } else {
    console.log('ℹ️  ci:gate not defined — skipping');
  }
  pass = run('verify:front-desk-pilot', 'verify:front-desk-pilot') && pass;

  process.exit(pass ? 0 : 1);
}

main();
