#!/usr/bin/env node
'use strict';

/**
 * R-08-5 — voice tenant contract smoke (verify script, not Jest).
 */
const { execSync } = require('child_process');
const path = require('path');

const MP = path.join(__dirname, '..', 'middleware-platform');

console.log('==> voice-tenant-contract-smoke');
execSync('node scripts/verify/verify-voice-tenant-contract.cjs', {
  cwd: MP,
  stdio: 'inherit',
  env: { ...process.env, META_KV_POLICY_STRICT: '1' }
});
console.log('✅ voice-tenant-contract-smoke passed');
