#!/usr/bin/env node
'use strict';

/**
 * Lightweight repo layout checks (referenced from root package.json verify:repo-layout).
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MP = path.join(ROOT, 'middleware-platform');

const required = [
  'middleware-platform/server.js',
  'middleware-platform/database.js',
  'middleware-platform/package.json',
  'unified-dashboard/business/today.html',
  'todos/PENDING.md',
  'scripts/dev/run.sh',
];

const deprecated = [
  { path: 'middleware-platform/start.sh', note: 'use scripts/dev/run.sh' },
];

const staleRootDb = ['middleware-dev.db', 'middleware-test.db'].filter((f) =>
  fs.existsSync(path.join(ROOT, f))
);

let failed = 0;

for (const rel of required) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) {
    console.error(`✗ missing required: ${rel}`);
    failed += 1;
  }
}

for (const item of deprecated) {
  if (fs.existsSync(path.join(ROOT, item.path))) {
    console.warn(`⚠ deprecated (still present): ${item.path} — ${item.note}`);
  }
}

if (staleRootDb.length) {
  console.warn(`⚠ stale root SQLite (run scripts/dev/run.sh to archive): ${staleRootDb.join(', ')}`);
}

const devDbLegacy = path.join(MP, 'middleware-dev.db');
const devDbCanonical = path.join(MP, 'var/db/middleware-dev.db');
if (fs.existsSync(devDbLegacy) && fs.existsSync(devDbCanonical)) {
  console.warn('⚠ split-brain: both middleware-platform/middleware-dev.db and var/db/middleware-dev.db exist');
}

if (failed) {
  console.error(`\n${failed} layout check(s) failed`);
  process.exit(1);
}

console.log('✓ repo layout OK');
