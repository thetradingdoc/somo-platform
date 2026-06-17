#!/usr/bin/env node
'use strict';

/**
 * Fail CI when legacy consumer brand strings appear in runtime code paths.
 * Usage: node scripts/check-brand-consumer-strings.cjs [--no-legacy-api-default-env]
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const noLegacyEnv = process.argv.includes('--no-legacy-api-default-env');
const strictLanding = process.argv.includes('--strict-landing-copy');

const SCAN_ROOTS = [
  path.join(ROOT, 'middleware-platform/services'),
  path.join(ROOT, 'middleware-platform/routes'),
  path.join(ROOT, 'middleware-platform/webhooks'),
  path.join(ROOT, 'middleware-platform/lib'),
  path.join(ROOT, 'middleware-platform/models'),
  path.join(ROOT, 'middleware-platform/adapters'),
  path.join(ROOT, 'middleware-platform/configure-retell.js'),
  path.join(ROOT, 'docs/voice-agent'),
  path.join(ROOT, 'patient-app'),
  path.join(ROOT, 'unified-dashboard/admin'),
  path.join(ROOT, 'unified-dashboard/assets/css/admin-portal.css'),
];

const ENV_FILES = [
  path.join(ROOT, 'middleware-platform/scripts/generate-cloudrun-env-yaml.cjs'),
  path.join(ROOT, 'middleware-platform/.env.staging.example'),
];

const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'test-results', 'playwright-report', '_archive']);
const EXT = new Set(['.js', '.cjs', '.mjs', '.ts', '.tsx', '.md', '.yaml', '.yml', '.html', '.css']);

const BANNED = [
  { re: /\bdodgecall\b/i, label: 'dodgecall' },
  { re: /\bdoclittle\b/i, label: 'doclittle' },
  { re: /\bmyskinandcare\b/i, label: 'myskinandcare' },
  { re: /drlittlekids@gmail\.com/i, label: 'drlittlekids@gmail.com (legacy — use richard@callsomo.com)' },
];

const ADMIN_BANNED = [
  { re: /#7[cC]5[dD][fF][aA]/, label: 'legacy admin purple #7c5dfa' },
  { re: /#38[bB][dD][fF]8/, label: 'legacy admin blue #38bdf8' },
  { re: /font-family:\s*["']?Inter["']?/i, label: 'Inter font (use League Spartan / --font-brand)' },
];

const ALLOW_PATH = [
  /[/\\]docs[/\\]archive[/\\]/i,
  /somo-demo-env\.js$/i,
  /check-brand-consumer-strings/i,
  /check-brand-strings/i,
  /check-legacy-hosts/i,
  /rebrand-somo/i,
  /backfill-fhir-callsomo/i,
  /fhir-brand-identifiers/i,
  /LEGACY_DOMAIN_RETIREMENT/i,
  /INFRA_BRAND_DEFERRAL/i,
  /doclittle\.health/i, // allowed only during dual-read migration window in fhir modules
];

const ALLOW_LINE = [
  /brand-allowlist/i,
  /legacy.*shim/i,
  /deprecated/i,
  /doclittle\.health/i,
  /doclittle_kelly_commerce_quote_v1/i,
  /dodgecall_demo_requests/i,
  /utm_source=dodgecall/i,
  /legacy utm/i,
  /source === 'dodgecall'/i,
];

const BANNED_ENV_PREFIX = /\bDODGECALL_/;

function scanFileForBannedEnv(filePath, text, violations) {
  if (!/somo-demo-env\.js$/i.test(filePath) && BANNED_ENV_PREFIX.test(text)) {
    const lines = text.split('\n');
    lines.forEach((line, i) => {
      if (BANNED_ENV_PREFIX.test(line) && !ALLOW_LINE.some((re) => re.test(line))) {
        violations.push({ file: filePath, line: i + 1, label: 'DODGECALL_ env (use SOMO_DEMO_ + somo-demo-env.js)', snippet: line.trim().slice(0, 120) });
      }
    });
  }
}

function walk(dir, files = []) {
  if (!fs.existsSync(dir)) return files;
  const st = fs.statSync(dir);
  if (st.isFile()) {
    if (shouldScan(dir)) files.push(dir);
    return files;
  }
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(ent.name)) continue;
    walk(path.join(dir, ent.name), files);
  }
  return files;
}

function shouldScan(filePath) {
  if (ALLOW_PATH.some((p) => p.test(filePath))) return false;
  const ext = path.extname(filePath);
  if (!EXT.has(ext) && !filePath.endsWith('configure-retell.js')) return false;
  return true;
}

function isAllowedLine(line) {
  return ALLOW_LINE.some((re) => re.test(line));
}

const files = [];
for (const root of SCAN_ROOTS) walk(root, files);
if (noLegacyEnv) files.push(...ENV_FILES.filter((f) => fs.existsSync(f)));

const violations = [];
for (const file of files) {
  const rel = path.relative(ROOT, file);
  const text = fs.readFileSync(file, 'utf8');
  scanFileForBannedEnv(rel, text, violations);
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    if (isAllowedLine(line)) return;
    const bannedList = /[/\\]admin[/\\]/.test(rel) || rel.includes('admin-portal.css') ? [...BANNED, ...ADMIN_BANNED] : BANNED;
    for (const { re, label } of bannedList) {
      if (re.test(line)) {
        violations.push({ file: rel, line: i + 1, label, snippet: line.trim().slice(0, 100) });
      }
    }
  });
}

if (strictLanding) {
  const landingReadme = path.join(ROOT, 'unified-dashboard/somo-landing/README.md');
  if (fs.existsSync(landingReadme)) {
    const text = fs.readFileSync(landingReadme, 'utf8');
    if (/myskinandcare/i.test(text)) {
      violations.push({ file: 'unified-dashboard/somo-landing/README.md', line: 0, label: 'myskinandcare', snippet: 'landing README' });
    }
  }
}

if (violations.length) {
  console.error(`check-brand-consumer-strings: ${violations.length} violation(s)\n`);
  for (const v of violations.slice(0, 50)) {
    console.error(`  ${v.file}:${v.line} [${v.label}] ${v.snippet}`);
  }
  if (violations.length > 50) console.error(`  ... and ${violations.length - 50} more`);
  process.exit(1);
}

console.log('check-brand-consumer-strings: OK');
