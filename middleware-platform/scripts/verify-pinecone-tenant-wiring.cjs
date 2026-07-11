#!/usr/bin/env node
'use strict';

/**
 * Phase 2b-04 — assert Pinecone tenant filter is wired on aggregateFromMatches path.
 */

const { execSync } = require('child_process');
const path = require('path');

const mp = path.join(__dirname, '..');

try {
  execSync(
    'npm test -- --runInBand --forceExit __tests__/pinecone-tenant-isolation.test.js',
    { cwd: mp, stdio: 'inherit', env: { ...process.env, SKIP_STARTUP_MIGRATIONS: '1' } }
  );
  console.log('✅ Pinecone tenant wiring verified');
} catch (e) {
  console.error('❌ Pinecone tenant wiring failed');
  process.exit(2);
}
