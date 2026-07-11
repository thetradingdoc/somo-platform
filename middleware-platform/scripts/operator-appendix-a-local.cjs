#!/usr/bin/env node
'use strict';

/**
 * Phase 3 / Appendix A — automate local D-01 steps (operator completes gcloud + prod snapshot).
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const MP = path.join(__dirname, '..');
const EVIDENCE_DIR = path.join(MP, 'var/evidence/coding-prod');

function run(cmd, opts = {}) {
  console.log(`\n▶ ${cmd}`);
  return execSync(cmd, { cwd: opts.cwd || MP, encoding: 'utf8', stdio: opts.silent ? 'pipe' : 'inherit' });
}

function main() {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  const log = [];

  log.push({ step: 'A4', cmd: 'npm run verify:pinecone-deploy-env' });
  try {
    run('npm run verify:pinecone-deploy-env', { silent: true });
    log[log.length - 1].status = 'pass';
  } catch (e) {
    log[log.length - 1].status = 'fail';
    log[log.length - 1].error = e.message;
  }

  if (process.argv.includes('--cloudrun')) {
    log.push({ step: 'A1', cmd: 'gcloud run services describe somo-middleware' });
    try {
      const out = run(
        'gcloud run services describe somo-middleware --project somo-callsomo --region us-central1 --format="yaml(spec.template.spec.containers[0].env)"',
        { silent: true }
      );
      const envFile = path.join(EVIDENCE_DIR, `${stamp}-d01-cloudrun-env.yaml`);
      fs.writeFileSync(envFile, out);
      log[log.length - 1].status = 'pass';
      log[log.length - 1].artifact = envFile;
    } catch (e) {
      log[log.length - 1].status = 'fail';
      log[log.length - 1].error = e.message;
    }
  }

  if (fs.existsSync(path.join(MP, 'var/db/middleware-dev.db'))) {
    for (const script of ['verify-live-spine.cjs', 'verify-triage-spine.cjs']) {
      log.push({ step: 'A7/A8', cmd: script });
      try {
        run(`DB_PATH=./var/db/middleware-dev.db USE_TRIAGE_RAG_V2=1 node scripts/${script}`, { silent: true });
        log[log.length - 1].status = 'pass';
      } catch (e) {
        log[log.length - 1].status = 'fail';
        log[log.length - 1].error = e.message;
      }
    }
  }

  const reportPath = path.join(EVIDENCE_DIR, `${stamp}-appendix-a-local.json`);
  fs.writeFileSync(reportPath, JSON.stringify({ generated_at: new Date().toISOString(), steps: log }, null, 2));
  console.log(`\n✅ Appendix A local report: ${reportPath}`);
  const failed = log.filter((s) => s.status === 'fail').length;
  process.exit(failed ? 1 : 0);
}

main();
