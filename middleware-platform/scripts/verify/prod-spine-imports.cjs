#!/usr/bin/env node
'use strict';

/**
 * Smoke-require production hot-path modules (module resolution + light load).
 * Replaces Jest import-shims / golden suites for ci:fast.
 *
 * Run: SKIP_STARTUP_MIGRATIONS=1 DB_PATH=:memory: node scripts/verify/prod-spine-imports.cjs
 */

const path = require('path');

const MP = path.join(__dirname, '..', '..');

process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.SKIP_STARTUP_MIGRATIONS = process.env.SKIP_STARTUP_MIGRATIONS || '1';
process.env.DB_PATH = process.env.DB_PATH || ':memory:';
process.env.KELLY_QUIET = '1';

/** Full require — Kelly / clinical spine (fast, no HTTP listen). */
const LOAD_MODULES = [
  'services/kelly/rails/execute-turn',
  'services/conversation/pivot-engine',
  'services/clinical/opqrst-field-gate',
  'services/kelly/kelly-turn-resolver',
  'services/voice/voice-routing-world',
  'services/voice/call-site-context',
];

/** Resolve-only — heavy boot (database migrations, WS handler graph). */
const RESOLVE_ONLY = [
  'database',
  'webhooks/retell-websocket',
];

let failed = 0;

for (const label of LOAD_MODULES) {
  try {
    require(path.join(MP, label));
    console.log(`✓ ${label}`);
  } catch (e) {
    console.error(`✗ ${label}: ${e.message}`);
    failed += 1;
  }
}

for (const label of RESOLVE_ONLY) {
  try {
    require.resolve(path.join(MP, label));
    console.log(`✓ ${label} (resolve)`);
  } catch (e) {
    console.error(`✗ ${label}: ${e.message}`);
    failed += 1;
  }
}

if (failed) {
  console.error(`\n${failed} prod-spine import(s) failed`);
  process.exit(1);
}

console.log('\n✓ prod-spine imports OK');
