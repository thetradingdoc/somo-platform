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

const devDbLegacy = path.join(MP, 'middleware-dev.db');
const devDbCanonical = path.join(MP, 'var/db/middleware-dev.db');

if (staleRootDb.length) {
  console.warn(`⚠ stale root SQLite outside var/db/ (archive or remove): ${staleRootDb.join(', ')}`);
}

if (fs.existsSync(devDbLegacy) && !fs.existsSync(devDbCanonical)) {
  console.warn('⚠ middleware-platform/middleware-dev.db exists outside var/db/ — use var/db/middleware-dev.db');
}

if (fs.existsSync(devDbLegacy) && fs.existsSync(devDbCanonical)) {
  console.warn('⚠ split-brain: both middleware-platform/middleware-dev.db and var/db/middleware-dev.db exist');
}

const forbiddenTracked = [
  'middleware-platform/var/evidence',
  'middleware-platform/e2e-artifacts',
  'middleware-platform/screenshots',
];

for (const rel of forbiddenTracked) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) continue;
  const entries = fs.readdirSync(abs, { withFileTypes: true });
  if (entries.length > 0) {
    console.warn(`⚠ ${rel}/ should be gitignored (has ${entries.length} entries) — do not git add`);
  }
}

const refactorDocs = [
  'middleware-platform/docs/ONBOARDING.md',
  'middleware-platform/docs/REFACTOR_LOG.md',
];
for (const rel of refactorDocs) {
  if (!fs.existsSync(path.join(ROOT, rel))) {
    console.warn(`⚠ missing refactor doc: ${rel}`);
  }
}

// After refactor Phase 2+: warn on new flat services at package services/ root (allowlist legacy shims)
const servicesDir = path.join(MP, 'services');
const flatServiceCutoff = new Date('2026-06-22T00:00:00Z');
if (fs.existsSync(servicesDir)) {
  for (const name of fs.readdirSync(servicesDir)) {
    if (!name.endsWith('.js')) continue;
    const filePath = path.join(servicesDir, name);
    const raw = fs.readFileSync(filePath, 'utf8');
    if (raw.includes('@deprecated shim')) continue;
    const stat = fs.statSync(filePath);
    if (stat.mtime > flatServiceCutoff) {
      console.warn(`⚠ new flat service at services/${name} — prefer services/<domain>/`);
    }
  }
}

if (failed) {
  console.error(`\n${failed} layout check(s) failed`);
  process.exit(1);
}

console.log('✓ repo layout OK');
