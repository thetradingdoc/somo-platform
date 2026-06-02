#!/usr/bin/env node
'use strict';

/**
 * Ensure retired Azure / doclittle deploy entrypoints are not reintroduced.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const FORBIDDEN_PATHS = [
  'scripts/deploy-to-azure.sh',
  'scripts/configure-azure-env.sh',
  'scripts/configure-azure-env.js',
  '.github/workflows/deploy-infrastructure.yml',
  'middleware-platform/services/azure-domain-service.js',
];

let failed = false;
for (const rel of FORBIDDEN_PATHS) {
  const full = path.join(ROOT, rel);
  if (fs.existsSync(full)) {
    console.error(`guardrail-no-azure-deploy: forbidden path exists: ${rel}`);
    failed = true;
  }
}

if (failed) process.exit(1);
console.log('guardrail-no-azure-deploy: OK');
