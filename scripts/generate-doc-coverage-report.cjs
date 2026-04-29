#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function getTrackedFiles() {
  return execSync('git ls-files', { encoding: 'utf8' })
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

function readDocsBlob() {
  const tracked = getTrackedFiles().filter((f) => f.startsWith('docs/') && f.endsWith('.md'));
  return tracked
    .map((f) => {
      try {
        return fs.readFileSync(f, 'utf8');
      } catch (_) {
        return '';
      }
    })
    .join('\n');
}

function matchesCodeScope(file) {
  return (
    (file.startsWith('middleware-platform/') ||
      file.startsWith('unified-dashboard/littlelab-landing/src/') ||
      file.startsWith('patient-app/') ||
      file.startsWith('scripts/')) &&
    /\.(js|cjs|mjs|ts|tsx)$/.test(file)
  );
}

function main() {
  const tracked = getTrackedFiles();
  const docsBlob = readDocsBlob();
  const code = tracked.filter(matchesCodeScope);
  const routeFiles = code.filter((f) => f.startsWith('middleware-platform/routes/'));
  const serviceFiles = code.filter((f) => f.startsWith('middleware-platform/services/'));

  function unmentioned(files) {
    return files.filter((f) => {
      const base = path.basename(f);
      return !docsBlob.includes(f) && !docsBlob.includes(base);
    });
  }

  const out = {
    generated_at: new Date().toISOString(),
    totals: {
      code_files: code.length,
      route_files: routeFiles.length,
      service_files: serviceFiles.length
    },
    unmentioned: {
      code: unmentioned(code),
      routes: unmentioned(routeFiles),
      services: unmentioned(serviceFiles)
    }
  };

  const target = process.argv[2] || 'tmp/docs-coverage-report.json';
  const dir = path.dirname(target);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(target, JSON.stringify(out, null, 2));
  process.stdout.write(`wrote ${target}\n`);
}

main();
