#!/usr/bin/env node
'use strict';

/**
 * Health video acceptance orchestrator.
 * Usage: node scripts/health-acceptance.cjs [--offline] [--live]
 */
const { spawnSync } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const offline = args.includes('--offline') || !args.includes('--live');
const live = args.includes('--live');

const JEST_PATTERN =
  "health-(session|turn|video|token|rag|safety|diagnosis|opqrst|vision|derm|care-pathway)";

function run(cmd, cmdArgs, opts = {}) {
  console.log(`\n==> ${cmd} ${cmdArgs.join(' ')}`);
  const r = spawnSync(cmd, cmdArgs, { cwd: ROOT, stdio: 'inherit', shell: false, ...opts });
  if (r.status !== 0) {
    process.exit(r.status || 1);
  }
}

run('npm', ['test', '--', '--runInBand', `--testPathPattern=${JEST_PATTERN}`]);
run('node', ['scripts/health-acceptance-layer0.cjs']);

if (live) {
  if (process.env.GROQ_API_KEY) {
    run('node', ['scripts/health-acceptance-golden.cjs']);
  } else {
    console.log('SKIP live golden: GROQ_API_KEY unset');
  }
  if (process.env.DERM_EDUCATION_PIPELINE_ENABLED === 'true') {
    run('node', ['scripts/health-acceptance-layer2.cjs']);
  } else {
    console.log('SKIP live layer2: DERM_EDUCATION_PIPELINE_ENABLED not true');
  }
} else if (offline) {
  console.log('\nOffline acceptance complete (use --live for Groq/RAG gates).');
}

console.log('\n✅ health:acceptance passed');
