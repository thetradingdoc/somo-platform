#!/usr/bin/env node
/**
 * OPQRST Field Gate ship checklist — F-2, DoD smoke, R-5a, Phase C EN cohort.
 *
 * Usage:
 *   node scripts/opqrst/opqrst-f2-ship-checklist.cjs
 *   DB_PATH=./middleware-staging.db node scripts/opqrst/opqrst-f2-ship-checklist.cjs
 *   OPQRST_F2_DEPLOY=1 node scripts/opqrst/opqrst-f2-ship-checklist.cjs  # also update Cloud Run env
 */
'use strict';

const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const steps = [];

function run(label, cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd: root, encoding: 'utf8', ...opts });
  const ok = r.status === 0;
  steps.push({ label, ok, stdout: (r.stdout || '').slice(-2000), stderr: (r.stderr || '').slice(-500) });
  if (!ok && !opts.allowFail) throw new Error(`${label} failed`);
  return r;
}

function main() {
  console.log('==> OPQRST Field Gate ship checklist\n');

  run('test:opqrst-field-gate', 'npm', ['run', 'test:opqrst-field-gate'], {
    env: { ...process.env, OPQRST_FIELD_GATE_ENABLED: '1' }
  });
  run('voice-dod-smoke', process.execPath, ['scripts/opqrst/opqrst-voice-dod-smoke.cjs']);
  run('phase-c-en-cohort', process.execPath, ['scripts/opqrst/opqrst-phase-c-en-cohort.cjs']);
  run('tenant-billing-pivot-smoke', process.execPath, ['scripts/tenant-billing-pivot-smoke.cjs']);
  run('opqrst-freeze-e2e', process.execPath, ['scripts/opqrst/opqrst-freeze-e2e.cjs'], {
    env: { ...process.env, OPQRST_FIELD_GATE_ENABLED: '1' }
  });

  if (process.env.DB_PATH && fs.existsSync(process.env.DB_PATH)) {
    run('r5a-frequency', process.execPath, ['scripts/opqrst/opqrst-billing-pivot-frequency.cjs'], {
      env: { ...process.env, R5A_PROFILE: process.env.R5A_PROFILE || 'staging' }
    });
  } else {
    steps.push({ label: 'r5a-frequency', ok: null, note: 'skipped — set DB_PATH to staging/prod sqlite' });
  }

  run('f2-burn-in-verify', process.execPath, ['scripts/opqrst/opqrst-f2-burn-in-verify.cjs'], {
    env: process.env,
    allowFail: true
  });

  if (process.env.OPQRST_F2_DEPLOY === '1') {
    const upd = spawnSync(
      'gcloud',
      [
        'run',
        'services',
        'update',
        process.env.GCP_SERVICE || 'somo-middleware',
        '--region',
        process.env.GCP_REGION || 'us-central1',
        '--project',
        process.env.GCP_PROJECT || 'somo-callsomo',
        '--update-env-vars',
        'OPQRST_FIELD_GATE_ENABLED=1'
      ],
      { encoding: 'utf8' }
    );
    steps.push({
      label: 'cloudrun-env-update',
      ok: upd.status === 0,
      stdout: upd.stdout,
      stderr: upd.stderr
    });
    if (upd.status !== 0) throw new Error('cloudrun-env-update failed');
  }

  const report = {
    ts: new Date().toISOString(),
    steps,
    all_ok: steps.every((s) => s.ok !== false)
  };
  const outPath = path.join(root, '..', 'docs', 'clinical', 'OPQRST_FIELD_GATE_SHIP_REPORT.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log('\n==> Report:', outPath);
  console.log(JSON.stringify(report, null, 2));
  if (!report.all_ok) process.exit(1);
}

try {
  main();
} catch (e) {
  console.error('❌', e.message);
  process.exit(1);
}
