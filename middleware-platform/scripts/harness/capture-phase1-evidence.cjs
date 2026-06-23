#!/usr/bin/env node
'use strict';

/**
 * Phase 1 evidence bundle — terminal proofs (seeded Paul labeled not Phase 1 proof).
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const mp = path.join(__dirname, '..');
const outDir = path.join(mp, 'var', 'evidence', 'phase1');
fs.mkdirSync(outDir, { recursive: true });

const env = { ...process.env, DB_PATH: './var/db/middleware-dev.db', SKIP_STARTUP_MIGRATIONS: '1' };

function run(label, cmd, optional = false) {
  const logPath = path.join(outDir, `${label}.log`);
  const timeout = label === 'verify_live_spine' ? 180000 : 120000;
  try {
    const out = execSync(cmd, {
      cwd: mp,
      encoding: 'utf8',
      env: {
        ...env,
        EVAL_USE_SEMANTIC: 'false',
        REMOTE_RAG_TIMEOUT_MS: process.env.REMOTE_RAG_TIMEOUT_MS || '8000'
      },
      timeout
    });
    fs.writeFileSync(logPath, out);
    return { ok: true, logPath, optional };
  } catch (e) {
    const out = [e.stdout, e.stderr, e.message].filter(Boolean).join('\n');
    fs.writeFileSync(logPath, out);
    return { ok: false, logPath, optional, optional_fail: optional };
  }
}

const steps = {
  verify_db_path: run('verify_db_path', 'node scripts/verify/verify-db-path.cjs'),
  verify_threshold_ssot: run('verify_threshold_ssot', 'node scripts/verify/verify-threshold-ssot.cjs'),
  verify_payer_model: run('verify_payer_model', 'node scripts/verify/verify-payer-model.cjs'),
  verify_cpt_routing: run('verify_cpt_routing', 'node scripts/verify/verify-cpt-routing.cjs'),
  verify_session4_quote: run('verify_session4_quote', 'node scripts/harness/session4-quote-harness.cjs'),
  verify_session5_gates: run('verify_session5_gates', 'node scripts/harness/session5-gates-harness.cjs'),
  verify_live_spine: run('verify_live_spine', 'node scripts/verify/verify-live-spine.cjs', false),
  paul_copay_seeded: run('paul_copay_seeded_NOT_PHASE1_PROOF', 'node scripts/simulate_paul_journey.js --scenario=copay_due', true),
  verify_session3_spine: run('verify_session3_spine', 'node scripts/harness/session3-insurance-spine-harness.cjs'),
  verify_session1_spine: run('verify_session1_spine', 'node scripts/harness/session1-spine-harness.cjs')
  // jest_core retired — npm test no longer runs __tests__/; session harnesses above replace payer-quote, journey-gates, collect-insurance, kelly-rails unit suites
};

const requiredFailed = Object.entries(steps)
  .filter(([, v]) => !v.ok && !v.optional)
  .map(([k]) => k);
const optionalFailed = Object.entries(steps)
  .filter(([, v]) => !v.ok && v.optional)
  .map(([k]) => k);

const summary = {
  generated_at: new Date().toISOString(),
  out_dir: outDir,
  note: 'paul_copay_seeded is harness theatre — not Phase 1 proof. Phase 1 requires verify-live-call on real session_id.',
  steps,
  success: requiredFailed.length === 0,
  required_failed: requiredFailed,
  optional_failed: optionalFailed
};

fs.writeFileSync(path.join(outDir, 'SUMMARY.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ success: summary.success, required_failed: requiredFailed, optional_failed: optionalFailed }, null, 2));
process.exit(requiredFailed.length ? 2 : 0);
