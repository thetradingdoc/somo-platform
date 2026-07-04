#!/usr/bin/env node
'use strict';

/**
 * Ensure global admin auth middleware is registered before wallboard/onboarding mounts.
 */
const fs = require('fs');
const path = require('path');

const SERVER = path.join(__dirname, '..', 'server.js');
const content = fs.readFileSync(SERVER, 'utf8');

const authIdx = content.indexOf("app.use('/api/admin', requireAdminAuth)");
const wallboardIdx = content.indexOf("app.use('/api/admin/wallboard'");
const onboardingIdx = content.indexOf("app.use('/api/admin/voice-onboarding'");

const failures = [];

if (authIdx < 0) {
  failures.push('missing app.use(\'/api/admin\', requireAdminAuth)');
}
if (wallboardIdx < 0) {
  failures.push('missing admin wallboard mount');
}
if (onboardingIdx < 0) {
  failures.push('missing admin voice-onboarding mount');
}
if (authIdx >= 0 && wallboardIdx >= 0 && wallboardIdx < authIdx) {
  failures.push('wallboard mounted before global requireAdminAuth');
}
if (authIdx >= 0 && onboardingIdx >= 0 && onboardingIdx < authIdx) {
  failures.push('voice-onboarding mounted before global requireAdminAuth');
}

if (failures.length) {
  console.error('check-admin-route-order: failed:\n');
  for (const msg of failures) console.error(`  - ${msg}`);
  process.exit(1);
}

console.log('check-admin-route-order: OK');
