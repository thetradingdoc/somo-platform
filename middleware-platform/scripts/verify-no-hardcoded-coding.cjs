#!/usr/bin/env node
'use strict';

/**
 * Fail if prod billing paths use synthetic writers, hardcoded CPT injection, or bypass paths.
 */

const fs = require('fs');
const path = require('path');

const mp = path.join(__dirname, '..');

const ALLOWLIST_PREFIXES = [
  path.join(mp, '__tests__'),
  path.join(mp, 'e2e'),
  path.join(mp, 'scripts/e2e-kelly-rcm-pay-conversation.cjs'),
  path.join(mp, 'scripts/kelly-voice-latency-probe.cjs'),
  path.join(mp, 'scripts/phase-b-f2-staging-prep.cjs'),
  path.join(mp, 'playwright.config.cjs'),
  path.join(mp, 'services/triage-rag-fast-complete.js'),
];

function isAllowlisted(file) {
  return ALLOWLIST_PREFIXES.some((p) => file === p || file.startsWith(p + path.sep));
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git') continue;
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.(js|cjs|mjs)$/.test(name)) out.push(full);
  }
  return out;
}

const SCAN_DIRS = ['services', 'routes', 'webhooks', 'utils'].map((d) => path.join(mp, d));
const SCAN_FILES = [
  path.join(mp, 'scripts/terminal-coding-call.cjs'),
  path.join(mp, 'scripts/verify-coding-hitl.cjs'),
  path.join(mp, 'server.js')
].filter((f) => fs.existsSync(f));

const PROD_FILES = [...SCAN_DIRS.flatMap((d) => walk(d)), ...SCAN_FILES].filter((f) => !isAllowlisted(f));

const SYNTHETIC_PATTERNS = [
  { re: /completeTriageRagForSession/, label: 'completeTriageRagForSession' },
  { re: /triage-rag-fast-complete/, label: 'triage-rag-fast-complete import' },
  { re: /primary_cpt\s*=\s*['"]99213['"]/, label: 'hardcoded 99213 injection' },
  { re: /L30\.9/, label: 'synthetic L30.9' }
];

const violations = [];
let syntheticWriters = 0;
let bypassPaths = 0;

for (const file of PROD_FILES) {
  const src = fs.readFileSync(file, 'utf8');
  const rel = path.relative(mp, file);
  for (const { re, label } of SYNTHETIC_PATTERNS) {
    if (re.test(src)) {
      syntheticWriters += 1;
      violations.push({ file: rel, issue: label });
    }
  }
  if (/KELLY_RAILS_FAST_RAG\s*!==\s*['"]0['"]/.test(src) || /KELLY_RAILS_FAST_RAG\s*\|\|\s*['"]1['"]/.test(src)) {
    bypassPaths += 1;
    violations.push({ file: rel, issue: 'FAST_RAG default-on pattern' });
  }
}

// Structural guards on core files
const coreChecks = [
  { file: 'utils/cpt-helper.js', must: ['codingSpineOnly', 'hitl_required'] },
  { file: 'services/kelly-tool-executor.js', must: ['CODING_REVIEW_REQUIRED', 'coding-review-service', 'seeded_for_harness'] },
  { file: 'services/kelly-rails/execute-turn.js', must: [], mustNot: ['completeTriageRagForSession'] },
  { file: 'services/kelly-rails/gates/opqrst.js', must: [], mustNot: ['triage-rag-fast-complete'] }
];

for (const check of coreChecks) {
  const full = path.join(mp, check.file);
  if (!fs.existsSync(full)) continue;
  const src = fs.readFileSync(full, 'utf8');
  for (const token of check.must || []) {
    if (!src.includes(token)) {
      violations.push({ file: check.file, issue: `missing ${token}` });
    }
  }
  for (const token of check.mustNot || []) {
    if (src.includes(token)) {
      bypassPaths += 1;
      violations.push({ file: check.file, issue: `forbidden ${token}` });
    }
  }
}

const voiceAppt = fs.readFileSync(path.join(mp, 'routes/voice-appointments.js'), 'utf8');
if (/mapAppointmentTypeToCPT\(appointment/.test(voiceAppt)) {
  violations.push({ file: 'routes/voice-appointments.js', issue: 'mapAppointmentTypeToCPT on appointment spine' });
}

const summary = {
  synthetic_writers: syntheticWriters,
  bypass_paths: bypassPaths,
  violations,
  success: violations.length === 0
};
console.log(JSON.stringify(summary, null, 2));
process.exit(summary.success ? 0 : 2);
