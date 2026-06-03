#!/usr/bin/env node
'use strict';

/**
 * Fail CI when retired infra or API paths appear in active docs.
 *
 * Usage: node scripts/check-docs-stale-strings.cjs
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DOCS = path.join(ROOT, 'docs');

const PATTERNS = [
  { re: /myskin-middleware/i, label: 'myskin-middleware (decommissioned Cloud Run service)' },
  { re: /\/api\/public\/dodgecall\//i, label: '/api/public/dodgecall/ (removed HTTP routes)' },
  { re: /dodgecall\/health/i, label: 'dodgecall/health probe (use somo-demo/health)' },
];

const ALLOW_PATH = [
  /[/\\]docs[/\\]archive[/\\]/i,
  /[/\\]legacy-doclittle-myskin[/\\]/i,
  /[/\\]agent[/\\]dodgecall[/\\]/i,
  /GCP_SOMO_SERVICE_CUTOVER\.md$/i,
  /check-docs-stale-strings\.cjs$/i,
  /INFRA_BRAND_DEFERRAL\.md$/i,
  /ENGINEERING_DOC_HYGIENE\.md$/i,
  /[/\\]deployment[/\\]OPERATIONS\.md$/i,
  /[/\\]Brand[/\\]README\.md$/i,
];

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out);
    else if (ent.name.endsWith('.md')) out.push(p);
  }
  return out;
}

const violations = [];
for (const file of walk(DOCS)) {
  if (ALLOW_PATH.some((p) => p.test(file))) continue;
  let text = fs.readFileSync(file, 'utf8');
  const histIdx = text.indexOf('## Historical');
  if (histIdx >= 0 && /Superseded/i.test(text)) {
    text = text.slice(0, histIdx);
  }
  for (const { re, label } of PATTERNS) {
    if (re.test(text)) {
      violations.push({ file: path.relative(ROOT, file), label });
    }
  }
}

if (violations.length) {
  console.error('Stale strings in active docs:\n');
  for (const v of violations) {
    console.error(`  ${v.file}: ${v.label}`);
  }
  process.exit(1);
}

console.log('check-docs-stale-strings: OK');
