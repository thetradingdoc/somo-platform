#!/usr/bin/env node
'use strict';
/* eslint-disable no-console */

const { spawnSync } = require('child_process');
const path = require('path');

const root = path.resolve(__dirname, '..');

function run(name, command, args, extra = {}) {
  console.log(`\n[reasoning-readiness] ${name}…`);
  const r = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, ...extra.env },
    ...extra
  });
  if (r.status !== 0) {
    console.error(`[reasoning-readiness] FAILED: ${name} (exit ${r.status})`);
    process.exit(typeof r.status === 'number' && r.status !== 0 ? r.status : 1);
  }
  console.log(`[reasoning-readiness] OK: ${name}`);
}

function main() {
  run('flag state', process.execPath, ['scripts/check-reasoning-flag-state.cjs']);
  if (process.env.REASONING_READINESS_SKIP_PINECONE === '1') {
    console.log('[reasoning-readiness] skipping pinecone (REASONING_READINESS_SKIP_PINECONE=1)');
  } else {
    run('pinecone vector readiness', process.execPath, ['scripts/verify/verify-reasoning-pinecone-readiness.cjs']);
  }
  run('reasoning guardrails', process.execPath, ['scripts/check-result-summary-reasoning-guardrails.cjs']);
  console.log('\n[reasoning-readiness] all steps passed.');
}

main();
