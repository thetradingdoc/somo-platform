#!/usr/bin/env node
'use strict';

/**
 * Fail CI when retired infra, API paths, or removed test runners appear in active docs.
 *
 * Usage: node scripts/check-docs-stale-strings.cjs
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DOCS = path.join(ROOT, 'docs');
const MP_DOCS = path.join(ROOT, 'middleware-platform', 'docs');

const PATTERNS = [
  { re: /myskin-middleware/i, label: 'myskin-middleware (decommissioned Cloud Run service)' },
  { re: /\/api\/public\/dodgecall\//i, label: '/api/public/dodgecall/ (removed HTTP routes)' },
  { re: /dodgecall\/health/i, label: 'dodgecall/health probe (use somo-demo/health)' },
  {
    re: /services\/kelly-rails\//,
    label: 'services/kelly-rails/ (use services/kelly/rails/)',
  },
  {
    re: /services\/conversation-mode\//,
    label: 'services/conversation-mode/ (use services/conversation/)',
  },
  {
    re: /middleware-platform\/__tests__\//,
    label: 'middleware-platform/__tests__/ (Jest removed 2026-06-22)',
  },
  {
    re: /\bnpx jest\b|\bjest --testPathPattern\b/,
    label: 'npx jest (use scripts/verify/* — see VERIFY_GATES.md)',
  },
  {
    re: /playwright\.prod\.config\.cjs/,
    label: 'playwright.prod.config.cjs (absent; use verify scripts)',
    allowIf: /may be absent|Known gap|removed|historical/i,
  },
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
  /[/\\]architecture[/\\]README\.md$/i,
  /[/\\]middleware-platform[/\\]README\.md$/i,
  /REFACTOR_LOG\.md$/i,
  /CODEBASE_REORGANIZATION\.md$/i,
  /VERIFY_SCRIPT_CATALOG\.md$/i,
  /VERIFY_GATES\.md$/i,
];

const ROOT_FILES = [
  path.join(ROOT, 'README.md'),
  path.join(ROOT, 'CONTRIBUTING.md'),
  path.join(ROOT, 'todos', 'PENDING.md'),
];

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out);
    else if (ent.name.endsWith('.md')) out.push(p);
  }
  return out;
}

function stripHistorical(text) {
  const histIdx = text.indexOf('## Historical');
  if (histIdx >= 0 && /Superseded|archival/i.test(text)) {
    return text.slice(0, histIdx);
  }
  const archivalNote = text.indexOf('> **Testing (2026-06-22):**');
  if (archivalNote >= 0) {
    // Keep header note; still scan body but allow __tests__ after first 500 chars in OPERATIONS-style docs
  }
  return text;
}

function checkFile(file, violations) {
  if (ALLOW_PATH.some((p) => p.test(file))) return;
  let text = fs.readFileSync(file, 'utf8');
  text = stripHistorical(text);

  // deployment/OPERATIONS.md has archival tables — skip lines with historical pass markers
  const lines = text.split('\n');
  const activeText = file.includes('deployment/OPERATIONS.md')
    ? lines.filter((l) => !l.includes('__tests__/') && !l.includes('jest ')).join('\n')
    : text;

  for (const { re, label, allowIf } of PATTERNS) {
    if (allowIf && allowIf.test(text) && re.test(text)) continue;
    if (re.test(activeText)) {
      violations.push({ file: path.relative(ROOT, file), label });
    }
  }
}

const violations = [];
for (const file of [...walk(DOCS), ...walk(MP_DOCS), ...ROOT_FILES]) {
  checkFile(file, violations);
}

if (violations.length) {
  console.error('Stale strings in active docs:\n');
  for (const v of violations) {
    console.error(`  ${v.file}: ${v.label}`);
  }
  process.exit(1);
}

console.log('check-docs-stale-strings: OK');
