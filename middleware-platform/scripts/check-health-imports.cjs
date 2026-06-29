#!/usr/bin/env node
'use strict';

/**
 * Health domain import firewall — services/health/** must not depend on
 * Kelly rails, commerce, checkout, or medical coding graphs.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HEALTH_DIR = path.join(ROOT, 'services', 'health');

const FORBIDDEN_PATTERNS = [
  /kelly-rails/,
  /kelly-tool-executor/,
  /services\/coding-/,
  /services\/checkout-/,
  /services\/commerce-/,
  /services\/kelly-agent-service/,
  /KellyToolExecutor/
];

function collectJsFiles(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) collectJsFiles(full, acc);
    else if (name.endsWith('.js')) acc.push(full);
  }
  return acc;
}

function checkFile(filePath) {
  const rel = path.relative(ROOT, filePath);
  const content = fs.readFileSync(filePath, 'utf8');
  const violations = [];
  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.test(content)) {
      violations.push(pattern.toString());
    }
  }
  return violations.length ? { rel, violations } : null;
}

function main() {
  const files = collectJsFiles(HEALTH_DIR);
  if (!files.length) {
    console.log('check-health-imports: services/health/ not found yet — skipping');
    process.exit(0);
  }
  const failures = files.map(checkFile).filter(Boolean);
  if (failures.length) {
    console.error('Health import firewall failed:\n');
    for (const f of failures) {
      console.error(`  ${f.rel}: ${f.violations.join(', ')}`);
    }
    process.exit(1);
  }
  console.log(`check-health-imports: OK (${files.length} files)`);
}

main();
