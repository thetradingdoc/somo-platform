#!/usr/bin/env node
'use strict';

/**
 * Single confidence threshold SSOT — gate services import coding-thresholds.js.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const GATE_FILES = [
  'services/journey-gates-service.js',
  'services/kelly-tool-executor.js',
  'services/voice-triage-guards.js',
  'services/resolve-insurance-codes.js',
  'utils/cpt-helper.js',
  'services/visit-codes-service.js',
  'webhooks/retell-websocket.js'
];

const violations = [];
for (const rel of GATE_FILES) {
  const full = path.join(ROOT, rel);
  if (!fs.existsSync(full)) continue;
  const src = fs.readFileSync(full, 'utf8');
  if (!src.includes('coding-thresholds')) {
    violations.push({ file: rel, reason: 'missing coding-thresholds import' });
  }
  if (/\b0\.7\b/.test(src) && !src.includes('BORDERLINE_WINDOW')) {
    violations.push({ file: rel, reason: 'hardcoded 0.7 threshold literal' });
  }
}

const { CODING_CONFIDENCE_THRESHOLD, BORDERLINE_WINDOW } = require('../config/coding-thresholds');

const report = {
  threshold_ssot: 'config/coding-thresholds.js',
  threshold: CODING_CONFIDENCE_THRESHOLD,
  borderline_window: BORDERLINE_WINDOW,
  scattered_literals: violations.length,
  violations,
  success: violations.length === 0
};

console.log(JSON.stringify(report, null, 2));
process.exit(report.success ? 0 : 2);
