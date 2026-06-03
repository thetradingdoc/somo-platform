#!/usr/bin/env node
'use strict';

/**
 * Phase B Track 1 — staging prep checklist (env + Cloud Run Kelly vars).
 * Does not run F2 (use test:e2e:rcm:conversation).
 */

const { spawnSync } = require('child_process');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const mpRoot = path.join(__dirname, '..');

function main() {
  console.log('=== Phase B F2 staging prep ===\n');

  const cloud = spawnSync('npm', ['run', 'verify:kelly-rails-cloudrun'], {
    cwd: mpRoot,
    encoding: 'utf8',
    env: process.env
  });
  console.log(cloud.stdout || '');
  if (cloud.stderr) console.error(cloud.stderr);

  const hasLlm = !!(
    process.env.ANTHROPIC_API_KEY ||
    process.env.GROQ_API_KEY ||
    process.env.OPENAI_API_KEY
  );
  console.log(`LLM key present: ${hasLlm ? 'yes' : 'NO — set ANTHROPIC_API_KEY or GROQ_API_KEY'}`);
  console.log(`DB_PATH: ${process.env.DB_PATH || '(default middleware-dev.db via database.js)'}`);
  console.log(`BASE_URL for F2 HTTP stages: ${process.env.BASE_URL || process.env.PW_API_BASE_URL || 'http://127.0.0.1:4000'}`);

  console.log('\nF2 command (staging-aligned DB recommended):');
  console.log(`  cd middleware-platform`);
  console.log(`  export KELLY_RAILS_V2=1 KELLY_ALLOW_HYBRID_GRAPH=0 KELLY_RAILS_ROLLOUT_PCT=1`);
  console.log(`  export LANGGRAPH_KELLY_ROLLOUT_PCT=0 RCM_E2E_USE_EXISTING_SERVER=1`);
  console.log(`  export KELLY_RAILS_FAST_RAG=1  # optional speed`);
  console.log(`  npm run test:e2e:rcm:conversation`);

  console.log('\nRuntime proof after F2 or staging chat:');
  console.log(`  DB_PATH=<staging.db> npm run verify:kelly-rails-runtime -- --session-id <sess>`);

  process.exit(cloud.status === 0 && hasLlm ? 0 : 1);
}

main();
