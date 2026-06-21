#!/usr/bin/env node
'use strict';

/**
 * Coding orchestration production evidence bundle (Sessions 1–5).
 * All required steps must exit 0; SUMMARY.json success: true.
 *
 * Usage: node scripts/capture-coding-prod-evidence.cjs
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const mp = path.join(__dirname, '..');
const outDir = path.join(mp, 'var', 'evidence', 'coding-prod');
fs.mkdirSync(outDir, { recursive: true });

const env = {
  ...process.env,
  DB_PATH: './var/db/middleware-dev.db',
  SKIP_STARTUP_MIGRATIONS: '1',
  USE_TRIAGE_RAG_V2: process.env.USE_TRIAGE_RAG_V2 || '1',
  EVAL_USE_SEMANTIC: process.env.EVAL_USE_SEMANTIC ?? 'false',
  REMOTE_RAG_TIMEOUT_MS: process.env.REMOTE_RAG_TIMEOUT_MS || '8000'
};

function hasLlmKey() {
  return !!(env.GROQ_API_KEY || env.OPENAI_API_KEY || env.ANTHROPIC_API_KEY);
}

function run(label, cmd, opts = {}) {
  const { optional = false, timeout = 120000, skip = false, skipReason = null } = opts;
  const logPath = path.join(outDir, `${label}.log`);
  if (skip) {
    const msg = `SKIPPED: ${skipReason || 'precondition not met'}`;
    fs.writeFileSync(logPath, msg);
    return { ok: true, logPath, optional, skipped: true, skip_reason: skipReason };
  }
  try {
    const out = execSync(cmd, { cwd: mp, encoding: 'utf8', env, timeout });
    fs.writeFileSync(logPath, out);
    return { ok: true, logPath, optional };
  } catch (e) {
    const out = [e.stdout, e.stderr, e.message].filter(Boolean).join('\n');
    fs.writeFileSync(logPath, out);
    return { ok: false, logPath, optional, optional_fail: optional };
  }
}

const steps = {
  verify_db_path: run('verify_db_path', 'node scripts/verify-db-path.cjs'),
  verify_threshold_ssot: run('verify_threshold_ssot', 'node scripts/verify-threshold-ssot.cjs'),
  verify_live_spine: run('verify_live_spine', 'node scripts/verify-live-spine.cjs', { timeout: 180000 }),
  verify_triage_spine: run('verify_triage_spine', 'node scripts/verify-triage-spine.cjs', { timeout: 180000 }),
  verify_coding_hitl: run('verify_coding_hitl', 'node scripts/verify-coding-hitl.cjs'),
  verify_no_hardcoded_coding: run('verify_no_hardcoded_coding', 'node scripts/verify-no-hardcoded-coding.cjs'),
  verify_routine_path: run('verify_routine_path', 'node scripts/verify-routine-path.cjs'),
  verify_voice_http_spine: run('verify_voice_http_spine', 'node scripts/verify-voice-http-spine.cjs'),
  verify_kelly_tools: run('verify_kelly_tools', 'node scripts/verify-kelly-tools.cjs'),
  verify_pair_validation: run('verify_pair_validation', 'node scripts/verify-pair-validation.cjs'),
  verify_quote_eligibility_chain: run('verify_quote_eligibility_chain', 'node scripts/verify-quote-eligibility-chain.cjs'),
  verify_kelly_http_collect: run('verify_kelly_http_collect', 'node scripts/verify-kelly-http-collect.cjs'),
  verify_payer_model: run('verify_payer_model', 'node scripts/verify-payer-model.cjs'),
  verify_cpt_routing: run('verify_cpt_routing', 'node scripts/verify-cpt-routing.cjs'),
  terminal_coding_call_all: run(
    'terminal_coding_call_all',
    'node scripts/terminal-coding-call.cjs --all --no-assist',
    {
      timeout: 600000,
      skip: !hasLlmKey(),
      skipReason: 'Missing GROQ_API_KEY, OPENAI_API_KEY, or ANTHROPIC_API_KEY'
    }
  ),
  jest_core: run(
    'jest_core',
    'npm test -- --runInBand --forceExit __tests__/payer-quote-service.test.js __tests__/journey-gates.test.js __tests__/collect-insurance-spine.test.js __tests__/collect-insurance-http-spine.test.js __tests__/coding-layer-leaks.test.js __tests__/kelly-rails-execute-turn.test.js',
    { timeout: 300000 }
  )
};

const requiredFailed = Object.entries(steps)
  .filter(([, v]) => !v.ok && !v.optional && !v.skipped)
  .map(([k]) => k);
const skipped = Object.entries(steps)
  .filter(([, v]) => v.skipped)
  .map(([k]) => k);

const summary = {
  generated_at: new Date().toISOString(),
  out_dir: outDir,
  note: 'Production coding orchestration DoD — live spine, HITL, terminal runKellyTurn (no harness seed).',
  steps,
  success: requiredFailed.length === 0,
  required_failed: requiredFailed,
  skipped
};

fs.writeFileSync(path.join(outDir, 'SUMMARY.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ success: summary.success, required_failed: requiredFailed, skipped }, null, 2));
process.exit(requiredFailed.length ? 2 : 0);
