#!/usr/bin/env node
'use strict';

/**
 * Sessions 4–7 evidence bundle runner.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const mp = path.join(__dirname, '..');
const outDir = path.join(mp, 'var', 'evidence', 'sessions4567');
fs.mkdirSync(outDir, { recursive: true });

const env = { ...process.env, DB_PATH: './var/db/middleware-dev.db', SKIP_STARTUP_MIGRATIONS: '1' };

function run(label, cmd) {
  const logPath = path.join(outDir, `${label}.log`);
  try {
    const out = execSync(cmd, { cwd: mp, encoding: 'utf8', env });
    fs.writeFileSync(logPath, out);
    return { ok: true, logPath };
  } catch (e) {
    const out = [e.stdout, e.stderr, e.message].filter(Boolean).join('\n');
    fs.writeFileSync(logPath, out);
    return { ok: false, logPath };
  }
}

const steps = {
  session4_quote: run('session4_quote', 'node scripts/harness/session4-quote-harness.cjs'),
  session5_gates: run('session5_gates', 'node scripts/harness/session5-gates-harness.cjs'),
  paul_copay_due: run('paul_copay_due', 'node scripts/simulate_paul_journey.js --scenario=copay_due'),
  paul_fully_covered: run('paul_fully_covered', 'node scripts/simulate_paul_journey.js --scenario=fully_covered'),
  paul_cannot_determine: run('paul_cannot_determine', 'node scripts/simulate_paul_journey.js --scenario=cannot_determine'),
  verify_cpt_routing: run('verify_cpt_routing', 'node scripts/verify/verify-cpt-routing.cjs')
  // tests step retired — npm test no longer runs __tests__/; session4/5 harnesses + verify-cpt-routing replace deleted unit suites
};

const failed = Object.entries(steps).filter(([, v]) => !v.ok).map(([k]) => k);
const summary = { generated_at: new Date().toISOString(), out_dir: outDir, steps, success: failed.length === 0 };
fs.writeFileSync(path.join(outDir, 'SUMMARY.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ success: summary.success, failed }, null, 2));
process.exit(failed.length ? 2 : 0);
