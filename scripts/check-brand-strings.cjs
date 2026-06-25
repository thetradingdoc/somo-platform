#!/usr/bin/env node
'use strict';

/**
 * Fail CI when banned legacy brand strings appear in user-facing UI paths.
 * Allowlist: infra URLs, internal module paths, docs/archive, brand-allowlist comments.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SCAN_ROOTS = [
  path.join(ROOT, 'unified-dashboard'),
  path.join(ROOT, 'middleware-platform/public'),
];

const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  'hosting-dist',
  '.git',
  'playwright-report',
  'test-results',
  'dodgecall/dist',
  '_archive',
]);

const EXT = new Set(['.html', '.css', '.js', '.jsx', '.json', '.webmanifest', '.tsx', '.ts']);

const BANNED = [
  { re: /\bdodgecall\b/i, label: 'dodgecall' },
  { re: /\bdoclittle\b/i, label: 'doclittle' },
  { re: /\bdoctor\s+little\b/i, label: 'doctor little' },
  { re: /\bmyskinandcare\b/i, label: 'myskinandcare (display)' },
  { re: /\bskin\s*&\s*care\b/i, label: 'skin & care' },
];

const ALLOW_PATH = [
  /middleware-platform\/services\/dodgecall-/i,
  /\/api\/public\/dodgecall\//i,
  /dodgecall-demo/i,
  /business\/trial-activation\.html/i,
  /brand-allowlist/i,
  /docs\/archive\//i,
  /INFRA_BRAND_DEFERRAL/i,
  /check-brand-strings/i,
  /rebrand-somo-ui/i,
];

const ALLOW_LINE = [
  /brand-allowlist/i,
  /process\.env\./i,
  /STEDI_/i,
  /KELLY_/i,
  /dodgecall-demo/i,
  /dodgecallDemo/i,
  /isDodgecallApiPath/i,
  /\/dodgecall\//,
  /source === 'dodgecall'/,
];

function walk(dir, files = []) {
  if (!fs.existsSync(dir)) return files;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(ent.name)) continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, files);
    else if (EXT.has(path.extname(ent.name))) files.push(p);
  }
  return files;
}

function isAllowedFile(file) {
  return ALLOW_PATH.some((re) => re.test(file));
}

function isAllowedLine(line) {
  return ALLOW_LINE.some((re) => re.test(line));
}

const violations = [];

for (const base of SCAN_ROOTS) {
  for (const file of walk(base)) {
    const rel = path.relative(ROOT, file);
    if (isAllowedFile(rel)) continue;
    let raw;
    try {
      raw = fs.readFileSync(file, 'utf8');
    } catch (err) {
      if (err && err.code === 'ENOENT') continue;
      throw err;
    }
    const lines = raw.split('\n');
    lines.forEach((line, i) => {
      if (isAllowedLine(line)) return;
      for (const { re, label } of BANNED) {
        if (re.test(line)) {
          violations.push({ file: rel, line: i + 1, label, snippet: line.trim().slice(0, 120) });
        }
      }
    });
  }
}

const API_PUBLIC = path.join(ROOT, 'middleware-platform', 'public');
const LOGO_BANNED_IN_API_HTML = [
  { re: /somo-logo-wordmark\.svg/i, label: 'deprecated text-only logo (use somo-logo.png)' },
  { re: /<span[^>]*class=["']doc["']/i, label: 'DocLittle CSS logo spans' },
  { re: /<span[^>]*class=["']little["']/i, label: 'DocLittle CSS logo spans' },
];

for (const file of walk(API_PUBLIC).filter((f) => f.endsWith('.html'))) {
  const rel = path.relative(ROOT, file);
  const raw = fs.readFileSync(file, 'utf8');
  const lines = raw.split('\n');
  lines.forEach((line, i) => {
    if (isAllowedLine(line)) return;
    for (const { re, label } of LOGO_BANNED_IN_API_HTML) {
      if (re.test(line)) {
        violations.push({ file: rel, line: i + 1, label, snippet: line.trim().slice(0, 120) });
      }
    }
  });
}

if (violations.length) {
  console.error(`check-brand-strings: ${violations.length} violation(s)\n`);
  for (const v of violations.slice(0, 50)) {
    console.error(`  ${v.file}:${v.line} [${v.label}] ${v.snippet}`);
  }
  if (violations.length > 50) console.error(`  ... and ${violations.length - 50} more`);
  process.exit(1);
}

console.log('check-brand-strings: OK');
