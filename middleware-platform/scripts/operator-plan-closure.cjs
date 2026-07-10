#!/usr/bin/env node
'use strict';

/**
 * Provider production plan — local closure runner.
 * Runs every automatable gate; prints operator-blocked items with commands.
 *
 * Usage:
 *   node scripts/operator-plan-closure.cjs
 *   LIVE=1 node scripts/operator-plan-closure.cjs   # include prod endpoint probes
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'test-results', 'operator-plan-closure.json');

function run(cmd, args, label, env = {}) {
  const r = spawnSync(cmd, args, {
    cwd: ROOT,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    timeout: 600_000
  });
  const ok = r.status === 0;
  const stderr = String(r.stderr || '');
  const stdout = String(r.stdout || '');
  const twilioStderr = /Twilio API Error/i.test(stderr) || /Twilio API Error/i.test(stdout);
  return {
    id: label,
    pass: ok && !twilioStderr,
    exitCode: r.status,
    twilioStderr,
    stdoutTail: stdout.split('\n').slice(-8).join('\n'),
    stderrTail: stderr.split('\n').slice(-5).join('\n')
  };
}

function nodeScript(script, label, env = {}, extraArgs = []) {
  return run(process.execPath, [path.join(ROOT, script), ...extraArgs], label, env);
}

const OPERATOR_ONLY = [
  {
    id: '6.10',
    task: 'Stedi 271 multilingual live',
    command: 'VOICE_ELIGIBILITY_SIMULATE=0 STEDI_TEST_MODE=1 npm run test:eval:multilang:stedi-live',
    blocker: 'STEDI_API_KEY + payer sandbox'
  },
  {
    id: 'G2',
    task: 'Retention policy counsel sign-off',
    command: 'Update config/retention-policy.js after legal review',
    blocker: 'counsel'
  },
  {
    id: '12.3-OPS',
    task: 'Vendor BAA legal sign-off',
    command: 'docs/compliance/VENDOR_BAA_TRACKER.md',
    blocker: 'legal'
  },
  {
    id: '7.1',
    task: 'Postgres vs GCS reconciliation on prod',
    command: 'GCS_DB_BUCKET=… RETELL_API_KEY=… node scripts/verify-postgres-gcs-reconciliation.cjs',
    blocker: 'prod GCS bucket'
  },
  {
    id: '7.2',
    task: 'Mirror lag gate on prod',
    command: 'POSTGRES_URL=… STRICT=1 node scripts/verify-postgres-mirror-lag.cjs',
    blocker: 'prod Postgres'
  },
  {
    id: '7.3',
    task: 'Live PSTN matrix per vertical',
    command: 'VERTICAL_PSTN_LIVE=1 VERTICAL_*_DID=… node scripts/vertical-pstn-scenarios.cjs',
    blocker: 'live DIDs + phone'
  },
  {
    id: '7.4',
    task: 'Site context all verticals on prod DB',
    command: 'GCS_DB_BUCKET=… SITE_CTX_* node scripts/verify-tenant-site-context-all-verticals.cjs',
    blocker: 'prod GCS DB'
  },
  {
    id: '7.5',
    task: 'Cloud Run Kelly Rails env',
    command: 'npm run verify:kelly-rails-cloudrun',
    blocker: 'gcloud auth + Cloud Run'
  },
  {
    id: '7.6',
    task: 'Timed rollback drill <15 min',
    command: 'bash scripts/rollback-gcp-release.sh',
    blocker: 'prod deploy access'
  },
  {
    id: '10.1',
    task: '+363 prod bind + inbound',
    command: 'docs/deployment/PLATFORM_SALES_363_DEPLOY.md',
    blocker: 'Twilio +363 DID on prod'
  },
  {
    id: '10.2',
    task: 'Live +363 → CRM pipeline tier',
    command: 'Manual PSTN call → /admin/pipeline.html',
    blocker: 'live +363'
  },
  {
    id: 'ACC-01-11',
    task: 'Dental + cross-vertical live PSTN acceptance',
    command: 'Real phone: signup → voice-setup → book/cancel/quote/pay',
    blocker: 'prod PSTN + human QA'
  },
  {
    id: 'ACC-15',
    task: 'Live +363 CRM tiering acceptance',
    command: 'Inbound +363 call → pipeline tier',
    blocker: 'live +363'
  },
  {
    id: 'ACC-17',
    task: 'Second-person UI walkthrough',
    command: 'Non-engineer walks provider portal on callsomo.com',
    blocker: 'human QA'
  }
];

function main() {
  console.log('\n=== Provider plan closure (local automatable) ===\n');

  const automated = [
    nodeScript('scripts/verify-phase7-portal.cjs', '7.9-portal-structural'),
    nodeScript('scripts/phase7-release-smoke.cjs', '7.8-release-smoke', { PHASE7_SKIP_PORTAL: '0' }),
    nodeScript('scripts/verify-phase7-deploy-gate.cjs', '7.9-deploy-gate-local', { LIVE: '' }),
    nodeScript('scripts/rollback-drill.cjs', '7.6-rollback-dry-run', {}, ['--dry-run']),
    nodeScript('scripts/verify-postgres-gcs-reconciliation.cjs', '7.1-postgres-gcs-local'),
    nodeScript('scripts/verify-postgres-mirror-lag.cjs', '7.2-mirror-lag-local'),
    nodeScript('scripts/verify-tenant-provisioning.cjs', '7.10-tenant-provisioning-structural', {}, [
      '--structural'
    ]),
    nodeScript('scripts/verify-compliance-readiness.cjs', '12-compliance-readiness'),
    run('npm', ['run', 'test:e2e:tenant-audit:strict'], 'FE-tenant-audit-strict', {
      TENANT_AUDIT_FORCE_RESTART: '1',
      TENANT_AUDIT_STRICT: '1',
      PW_API_BASE_URL: 'http://127.0.0.1:4001'
    }),
    run('npm', ['run', 'test:eval:multilang'], 'ACC-13-multilang', {
      MULTILANG_EVAL_RUNS: '1',
      CONVERSATION_EVAL_STRICT: '1',
      VOICE_EVAL_SIMULATE_SMS: '1'
    })
  ];

  if (process.env.LIVE === '1') {
    const gcloud = spawnSync('gcloud', ['auth', 'list', '--filter=status:ACTIVE', '--format=value(account)'], {
      encoding: 'utf8'
    });
    const hasGcloud = gcloud.status === 0 && String(gcloud.stdout || '').trim().length > 0;
    if (hasGcloud) {
      automated.push(
        nodeScript('scripts/verify-phase7-deploy-gate.cjs', '7.9-deploy-gate-live', { LIVE: '1' })
      );
    } else {
      console.log('⚠️  Skipping 7.9-deploy-gate-live — gcloud not authenticated (operator 7.5)');
    }
  }

  const hasStedi = Boolean((process.env.STEDI_API_KEY || '').trim());
  if (hasStedi) {
    automated.push(
      run('npm', ['run', 'test:eval:multilang:stedi-live'], '6.10-stedi-live', {
        VOICE_ELIGIBILITY_SIMULATE: '0',
        STEDI_TEST_MODE: '1'
      })
    );
  }

  const results = automated.map((r) => {
    console.log(`${r.pass ? '✅' : '❌'} ${r.id}`);
    return r;
  });

  const passCount = results.filter((r) => r.pass).length;
  const failCount = results.filter((r) => !r.pass).length;

  const report = {
    completedAt: new Date().toISOString(),
    automated: results,
    operatorOnly: OPERATOR_ONLY,
    stediSkipped: !hasStedi,
    summary: {
      automatedPass: passCount,
      automatedFail: failCount,
      operatorPending: OPERATOR_ONLY.length
    }
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));

  console.log('\n── Operator-only (cannot close without prod / legal / human QA) ──');
  for (const row of OPERATOR_ONLY) {
    console.log(`  • ${row.id} — ${row.task}`);
    console.log(`    ${row.command}`);
  }

  if (!hasStedi) {
    console.log('\n⚠️  6.10 skipped — set STEDI_API_KEY to attempt live Stedi eval');
  }

  console.log(`\nReport: ${OUT}`);
  console.log(JSON.stringify(report.summary, null, 2));

  process.exit(failCount > 0 ? 1 : 0);
}

main();
