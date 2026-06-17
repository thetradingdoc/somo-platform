#!/usr/bin/env node
'use strict';

/**
 * Fail CI when legacy production hostnames appear in active code paths.
 * Excludes docs/archive, FHIR namespace, and demo seed emails by default.
 *
 * Usage: node scripts/check-legacy-hosts.cjs [--include-docs]
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const includeDocs = process.argv.includes('--include-docs');

const PATTERNS = [
  { re: /doclittle\.site/i, label: 'doclittle.site' },
  { re: /myskinandcare\.com/i, label: 'myskinandcare.com' },
  { re: /doctor-little-c688d/i, label: 'doctor-little-c688d' },
  { re: /api\.doclittle/i, label: 'api.doclittle' },
];

const SCAN_ROOTS = [
  'middleware-platform',
  'unified-dashboard',
  'scripts',
  'patient-app',
].map((d) => path.join(ROOT, d));

const ALLOW_PATH = [
  /[/\\]docs[/\\]archive[/\\]/i,
  /[/\\]archive[/\\]/i,
  /[/\\]_archive[/\\]/i,
  /fhir-adapter\.js$/i,
  /fhir-brand-identifiers\.js$/i,
  /seed-demo-accounts\.js$/i,
  /check-legacy-hosts\.cjs$/i,
  /guardrail-no-azure-deploy\.cjs$/i,
  /callsomo-operator-sync\.cjs$/i,
  /gcp-somo-billing-audit\.sh$/i,
  /\.env\.bak/i,
  /LEGACY_DOMAIN_RETIREMENT\.md$/i,
  /STAGING_MYSKINANDCARE\.md$/i,
  /legacy-doclittle-myskin[/\\]/i,
];

const EXT = new Set([
  '.js', '.cjs', '.mjs', '.html', '.yaml', '.yml', '.env', '.env.example',
  '.production', '.development', '.sh',
]);

function shouldScan(filePath) {
  if (!includeDocs && filePath.endsWith('.md')) return false;
  if (ALLOW_PATH.some((p) => p.test(filePath))) return false;
  const ext = path.extname(filePath);
  if (filePath.includes('.env.')) return true;
  if (!EXT.has(ext) && !filePath.endsWith('.env.staging.example')) return false;
  return true;
}

const SKIP_DIRS = new Set(['node_modules', 'hosting-dist', '.git', 'data', 'test-results']);

function walk(dir, out) {
  if (!fs.existsSync(dir)) return;
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const full = path.join(dir, name);
    let st;
    try {
      st = fs.lstatSync(full);
    } catch {
      continue;
    }
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) walk(full, out);
    else if (shouldScan(full)) out.push(full);
  }
}

const files = [];
for (const root of SCAN_ROOTS) walk(root, files);

const violations = [];
for (const file of files) {
  const rel = path.relative(ROOT, file);
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    for (const { re, label } of PATTERNS) {
      if (re.test(line)) {
        violations.push({ file: rel, line: i + 1, label, snippet: line.trim().slice(0, 120) });
      }
    }
  });
}

if (violations.length) {
  console.error(`check-legacy-hosts: ${violations.length} violation(s)\n`);
  for (const v of violations.slice(0, 40)) {
    console.error(`  ${v.file}:${v.line} [${v.label}] ${v.snippet}`);
  }
  if (violations.length > 40) {
    console.error(`  ... and ${violations.length - 40} more`);
  }
  process.exit(1);
}

console.log('check-legacy-hosts: OK');
