#!/usr/bin/env node
'use strict';

/**
 * Session 1 closeout — runs all S1 acceptance checks and saves evidence bundle.
 * Usage: node scripts/harness/session1-closeout.cjs
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const mp = path.join(__dirname, '..');
const outDir = path.join(mp, 'var', 'evidence', 'session1');
fs.mkdirSync(outDir, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const env = { ...process.env, DB_PATH: process.env.DB_PATH || './var/db/middleware-dev.db' };

function runStep(name, cmd) {
  const logPath = path.join(outDir, `${stamp}_${name}.log`);
  process.stderr.write(`\n==> ${name}\n`);
  try {
    const output = execSync(cmd, { cwd: mp, encoding: 'utf8', env, stdio: ['pipe', 'pipe', 'pipe'] });
    fs.writeFileSync(logPath, output);
    return { ok: true, logPath, output: output.trim() };
  } catch (e) {
    const output = [e.stdout, e.stderr, e.message].filter(Boolean).join('\n');
    fs.writeFileSync(logPath, output);
    return { ok: false, logPath, output: output.trim() };
  }
}

const summary = { generated_at: new Date().toISOString(), out_dir: outDir, steps: {} };

summary.steps.env_local = runStep(
  'env_local',
  `node -r dotenv/config -e "const k=['PINECONE_INDEX_HOST','PINECONE_API_KEY','OPENAI_API_KEY','RAG_API_URL','USE_TRIAGE_RAG_V2']; const m={}; for (const x of k) m[x]=process.env[x]? (x.includes('KEY')?'set':'value'):'MISSING'; console.log(JSON.stringify(m,null,2));" dotenv_config_path=.env`
);

summary.steps.pinecone_readiness = runStep(
  'pinecone_readiness',
  'node -r dotenv/config scripts/verify/verify-reasoning-pinecone-readiness.cjs dotenv_config_path=.env'
);

summary.steps.spine_harness = runStep('spine_harness', 'node scripts/harness/session1-spine-harness.cjs');

summary.steps.voice_evidence = runStep('voice_evidence', 'node scripts/harness/capture-session1-voice-evidence.cjs');

summary.steps.kelly_rails_runtime = runStep(
  'kelly_rails_runtime',
  'node scripts/verify/verify-kelly-rails-runtime-event.cjs'
);
// kelly_rails_tests retired — npm test no longer runs __tests__/; spine_harness + verify-kelly-rails-runtime-event replace kelly-rails-execute-turn.test.js

const summaryPath = path.join(outDir, `${stamp}_summary.json`);
fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

const failed = Object.entries(summary.steps).filter(([, v]) => !v.ok).map(([k]) => k);
console.log(JSON.stringify({ summary_path: summaryPath, failed, success: failed.length === 0 }, null, 2));
process.exit(failed.length ? 2 : 0);
