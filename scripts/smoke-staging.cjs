#!/usr/bin/env node
'use strict';

/**
 * Post-deploy staging smoke chain.
 * Usage: npm run smoke:staging
 */

const { spawnSync } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');
const mp = path.join(root, 'middleware-platform');
const UI = process.env.UI_BASE_URL || 'https://myskinandcare.com';
const API = process.env.MIDDLEWARE_API_BASE || 'https://api.myskinandcare.com';

function run(cmd, args, cwd, env = {}) {
  const r = spawnSync(cmd, args, {
    stdio: 'inherit',
    cwd,
    env: { ...process.env, ...env },
    shell: cmd === 'npm'
  });
  if (r.status !== 0) process.exit(r.status || 1);
}

console.log('\n==> smoke:staging\n');

run('node', ['scripts/check-gcp-bootstrap.cjs'], root, { UI_BASE_URL: UI, MIDDLEWARE_API_BASE: API });
run('npm', ['run', 'verify:prod:routing-smoke', '--prefix', 'middleware-platform'], root, {
  UI_BASE_URL: UI,
  MIDDLEWARE_API_BASE: API,
  SKIP_LANDING_TURN_SMOKE: '1'
});
run('node', ['scripts/verify-staging-hosting.cjs'], root);

const voiceEnv = spawnSync(process.execPath, ['scripts/verify-voice-env.cjs'], {
  stdio: 'inherit',
  cwd: mp
});
if (voiceEnv.status !== 0) {
  console.warn('⚠️  verify-voice-env failed (expected if no local .env) — continuing HTTP smoke');
}

console.log('\n✅ smoke:staging complete\n');
