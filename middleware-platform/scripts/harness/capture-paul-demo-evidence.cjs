#!/usr/bin/env node
'use strict';

/**
 * Save Paul demo evidence bundle: harness outputs + session1 spine + codebook parity.
 * Usage: node scripts/harness/capture-paul-demo-evidence.cjs
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const mp = path.join(__dirname, '..');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = path.join(mp, 'var', 'evidence', `paul-demo-${stamp}`);
fs.mkdirSync(outDir, { recursive: true });

const env = {
  ...process.env,
  DB_PATH: process.env.DB_PATH || './var/db/middleware-dev.db'
};

function run(label, cmd) {
  const logPath = path.join(outDir, `${label}.log`);
  try {
    const output = execSync(cmd, { cwd: mp, encoding: 'utf8', env });
    fs.writeFileSync(logPath, output);
    return { ok: true, logPath, output };
  } catch (e) {
    const output = (e.stdout || '') + (e.stderr || '') + (e.message || '');
    fs.writeFileSync(logPath, output);
    return { ok: false, logPath, output };
  }
}

const results = {
  generated_at: new Date().toISOString(),
  out_dir: outDir,
  steps: {}
};

results.steps.pinecone_readiness = run(
  'pinecone_readiness',
  'node -r dotenv/config scripts/verify/verify-reasoning-pinecone-readiness.cjs dotenv_config_path=.env'
);
results.steps.session1_spine = run('session1_spine', 'node scripts/harness/session1-spine-harness.cjs');
results.steps.codebook_parity = run(
  'codebook_parity',
  'SKIP_EMBED_CHECK=1 node scripts/verify/verify-codebook-parity.js'
);

for (const scenario of ['copay_due', 'fully_covered', 'cannot_determine']) {
  results.steps[`paul_${scenario}`] = run(
    `paul_${scenario}`,
    `node scripts/simulate_paul_journey.js --scenario=${scenario}`
  );
}

results.steps.verify_session3_spine = run(
  'verify_session3_spine',
  'node scripts/harness/session3-insurance-spine-harness.cjs'
);
results.steps.verify_session4_quote = run('verify_session4_quote', 'node scripts/harness/session4-quote-harness.cjs');
results.steps.verify_session5_gates = run('verify_session5_gates', 'node scripts/harness/session5-gates-harness.cjs');
// jest_gates retired — npm test no longer runs __tests__/; session harnesses above replace deleted unit suites

const summaryPath = path.join(outDir, 'summary.json');
fs.writeFileSync(summaryPath, JSON.stringify(results, null, 2));

const failed = Object.entries(results.steps).filter(([, v]) => !v.ok);
console.log(JSON.stringify({ out_dir: outDir, failed: failed.map(([k]) => k), success: failed.length === 0 }, null, 2));
process.exit(failed.length ? 2 : 0);
