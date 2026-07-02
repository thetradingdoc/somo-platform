#!/usr/bin/env node
'use strict';

/**
 * Apply pilot production env vars on Cloud Run (invite gate, rate limits, Slack webhooks).
 *
 * Usage:
 *   node scripts/setup-pilot-prod-env.cjs --dry-run
 *   node scripts/setup-pilot-prod-env.cjs --apply
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { spawnSync } = require('child_process');

const dryRun = process.argv.includes('--dry-run') || !process.argv.includes('--apply');
const service = process.env.CLOUDRUN_SERVICE || 'somo-middleware';
const region = process.env.GCP_REGION || 'us-central1';
const project = process.env.GCP_PROJECT || 'somo-callsomo';

function envVal(key) {
  return (process.env[key] || '').trim();
}

function main() {
  console.log('\n=== Pilot prod env (Cloud Run) ===\n');
  console.log(`mode: ${dryRun ? 'dry-run' : 'apply'}\n`);

  const vars = {
    PILOT_INVITE_ONLY: '1',
    PILOT_RATE_LIMIT_ENABLED: '1'
  };
  const eligSlack = envVal('ELIGIBILITY_ALERT_SLACK_WEBHOOK');
  const paySlack = envVal('PAYMENT_ALERT_SLACK_WEBHOOK');
  if (eligSlack) vars.ELIGIBILITY_ALERT_SLACK_WEBHOOK = eligSlack;
  if (paySlack) vars.PAYMENT_ALERT_SLACK_WEBHOOK = paySlack;

  console.log('Target env vars:');
  for (const [k, v] of Object.entries(vars)) {
    const display = k.includes('WEBHOOK') ? (v ? '(set)' : '(missing)') : v;
    console.log(`  ${k}=${display}`);
  }

  const encKey = envVal('API_KEY_ENCRYPTION_KEY');
  if (!encKey) {
    console.log('\n⚠️  API_KEY_ENCRYPTION_KEY not in .env — run ../scripts/provision-production-secrets.sh');
  } else {
    console.log('\n✅ API_KEY_ENCRYPTION_KEY present locally (bind via Secret Manager on deploy)');
  }

  if (!eligSlack || !paySlack) {
    console.log('\n⚠️  Slack webhooks missing in .env — add before --apply for fd-ops-strict-alerts-prod');
  }

  const pairs = Object.entries(vars)
    .map(([k, v]) => `${k}=${v}`)
    .join(',');
  const gcloudCmd = [
    'gcloud run services update',
    service,
    `--region=${region}`,
    `--project=${project}`,
    `--update-env-vars=${pairs}`
  ].join(' ');

  console.log('\n── gcloud command ──\n');
  console.log(gcloudCmd);

  if (dryRun) {
    console.log('\nRun with --apply to execute.\n');
    return;
  }

  const r = spawnSync(gcloudCmd, { shell: true, stdio: 'inherit' });
  if (r.status !== 0) {
    console.error('\n❌ gcloud update failed');
    process.exit(1);
  }
  console.log('\n✅ Cloud Run pilot prod env updated\n');
}

main();
