#!/usr/bin/env node
'use strict';

/**
 * Assert staging Firebase hosting bundle before deploy.
 * Usage: node scripts/verify-staging-hosting.cjs
 */

const fs = require('fs');
const path = require('path');

const dist = path.join(__dirname, '..', 'unified-dashboard', 'hosting-dist');

const required = [
  'index.html',
  'signup.html',
  'login.html',
  'business/agent.html',
  'assets/js/api-base.js',
  'terms.html'
];

function fail(msg) {
  console.error(`FAIL ${msg}`);
  process.exitCode = 1;
}

function pass(msg) {
  console.log(`PASS ${msg}`);
}

if (!fs.existsSync(dist)) {
  fail(`missing hosting-dist — run npm run build:staging-hosting`);
  process.exit(1);
}

for (const rel of required) {
  const full = path.join(dist, rel);
  if (!fs.existsSync(full)) {
    fail(`missing ${rel}`);
  } else {
    pass(rel);
  }
}

const apiBase = fs.readFileSync(path.join(dist, 'assets/js/api-base.js'), 'utf8');
if (!apiBase.includes('api.myskinandcare.com')) {
  fail('api-base.js must point to api.myskinandcare.com');
} else {
  pass('api-base.js → api.myskinandcare.com');
}

if (process.exitCode) {
  console.error('\nverify-staging-hosting failed\n');
  process.exit(1);
}
console.log('\nverify-staging-hosting OK\n');
