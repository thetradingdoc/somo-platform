#!/usr/bin/env node
'use strict';

const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');

function sh(cmd) {
  return execSync(cmd, { encoding: 'utf8' }).trim();
}

function listTracked() {
  return sh('git ls-files').split('\n').filter(Boolean);
}

function readDocs() {
  const files = listTracked().filter((f) => f.startsWith('docs/') && f.endsWith('.md'));
  return files.map((f) => fs.readFileSync(f, 'utf8')).join('\n');
}

function changedFiles() {
  const out = sh('git diff --name-only HEAD');
  return out ? out.split('\n').filter(Boolean) : [];
}

function fail(msg, items = []) {
  console.error(`DOC_PARITY_FAIL: ${msg}`);
  for (const i of items) console.error(` - ${i}`);
  process.exit(1);
}

function main() {
  const docs = readDocs();
  const requiredDocs = [
    'docs/meta/CODEBASE_BATCH_REVIEW_AND_DOC_GAPS.md',
    'docs/architecture/RUNTIME_ENTRYPOINTS_AND_CALL_PATHS.md',
    'docs/development/CODE_OWNERSHIP_BY_SURFACE.md',
    'docs/development/SCRIPTS_OPERATIONS_MAP.md'
  ];
  const missingRequiredDocs = requiredDocs.filter((f) => !fs.existsSync(f));
  if (missingRequiredDocs.length > 0) {
    fail('Required docs gap-closure files are missing', missingRequiredDocs);
  }

  const middlewareDoc = 'docs/middleware-platform/README.md';
  const middlewareText = fs.existsSync(middlewareDoc) ? fs.readFileSync(middlewareDoc, 'utf8') : '';
  const requiredSections = ['Runtime ownership quick map', 'Service-domain map anchors', 'new route checklist'];
  const missingSections = requiredSections.filter((s) => !middlewareText.toLowerCase().includes(s.toLowerCase()));
  if (missingSections.length > 0) {
    fail('Middleware docs missing required ownership/checklist sections', missingSections);
  }

  // Contributor lint: if route/service files changed, require docs changes in same diff.
  const diff = changedFiles();
  const routeOrServiceChanged = diff.some(
    (f) => f.startsWith('middleware-platform/routes/') || f.startsWith('middleware-platform/services/')
  );
  if (routeOrServiceChanged) {
    const docsChanged = diff.some((f) => f.startsWith('docs/'));
    if (!docsChanged) {
      fail('Routes/services changed without docs updates in same diff');
    }
  }

  console.log('DOC_PARITY_OK');
}

main();
