#!/usr/bin/env node
'use strict';

/**
 * R-08-5 — voice tenant contract smoke (unit subset).
 */
const { execSync } = require('child_process');
const path = require('path');

const MP = path.join(__dirname, '..', 'middleware-platform');
const tests = [
  '__tests__/voice-call-context.test.js',
  '__tests__/voice-settings-clinic.test.js',
  '__tests__/saas-tenant-provision.test.js',
  '__tests__/outbound-safety.test.js',
  '__tests__/ws-reconnect-site-context.test.js',
  '__tests__/meta-kv-policy.test.js',
  '__tests__/fhir-patient-clinic-scope.test.js',
  '__tests__/case-records-tenant.test.js'
].join(' ');

console.log('==> voice-tenant-contract-smoke');
execSync(`npm test -- --runInBand --forceExit ${tests}`, {
  cwd: MP,
  stdio: 'inherit',
  env: { ...process.env, META_KV_POLICY_STRICT: '1' }
});
execSync('node scripts/audit-voice-fhir-callers.cjs', { cwd: MP, stdio: 'inherit' });
console.log('✅ voice-tenant-contract-smoke passed');
