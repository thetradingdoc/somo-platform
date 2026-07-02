#!/usr/bin/env node
'use strict';

/**
 * Pilot production readiness — maps to pending fd-* todos in provider portal plan.
 * Informational in dev; set STRICT=1 or PILOT_PROD_STRICT=1 to fail on missing prod config.
 *
 * Usage:
 *   node scripts/verify-pilot-prod-readiness.cjs
 *   node scripts/verify-pilot-prod-readiness.cjs --clinic-id clinic-abc
 *   PILOT_PROD_STRICT=1 node scripts/verify-pilot-prod-readiness.cjs
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { spawnSync } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function truthy(v) {
  const s = String(v ?? '').trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes';
}

function check(report, name, ok, detail, todo) {
  report.checks.push({ name, ok, detail, todo });
  const icon = ok ? '✅' : report.strict ? '❌' : '⚠️';
  console.log(`${icon} ${name}${detail ? ` — ${detail}` : ''}${todo ? ` [${todo}]` : ''}`);
  if (!ok && report.strict) report.pass = false;
}

function main() {
  const strict = truthy(process.env.STRICT) || truthy(process.env.PILOT_PROD_STRICT);
  const clinicId = process.argv.includes('--clinic-id')
    ? process.argv[process.argv.indexOf('--clinic-id') + 1]
    : process.env.PHASE2_PILOT_CLINIC_ID || null;

  const report = { pass: true, strict, checks: [] };
  console.log('\n=== Pilot Prod Readiness ===\n');
  console.log(`mode: ${strict ? 'STRICT' : 'informational'}\n`);

  const apiKey = (process.env.STEDI_API_KEY || '').trim();
  const hasProdStediKey = Boolean(apiKey && !apiKey.startsWith('test_'));
  const stediTestMode = String(process.env.STEDI_TEST_MODE || '').trim();
  const simulate = String(process.env.VOICE_ELIGIBILITY_SIMULATE || '0').trim();

  check(
    report,
    'STEDI_API_KEY production-like',
    hasProdStediKey,
    hasProdStediKey ? 'prod key present' : apiKey ? 'test key only' : 'missing',
    'fd2-prod-stedi'
  );
  check(
    report,
    'STEDI_TEST_MODE=0',
    stediTestMode === '0',
    `current=${stediTestMode || '(unset)'}`,
    'fd-prod-stedi-cloudrun'
  );
  check(
    report,
    'VOICE_ELIGIBILITY_SIMULATE=0',
    simulate === '0',
    `current=${simulate || '(unset)'}`,
    'fd-prod-stedi-cloudrun'
  );

  check(
    report,
    'PILOT_INVITE_ONLY=1',
    truthy(process.env.PILOT_INVITE_ONLY),
    process.env.PILOT_INVITE_ONLY || '(unset)',
    'fd-ops-pilot-env-prod'
  );
  check(
    report,
    'PILOT_RATE_LIMIT_ENABLED=1',
    truthy(process.env.PILOT_RATE_LIMIT_ENABLED),
    process.env.PILOT_RATE_LIMIT_ENABLED || '(unset)',
    'fd-ops-pilot-env-prod'
  );

  const retellKey = (process.env.RETELL_API_KEY || '').trim();
  check(report, 'RETELL_API_KEY set', Boolean(retellKey), retellKey ? 'configured' : 'missing', 'fd-prod-retell-sync');

  const encKey = (process.env.API_KEY_ENCRYPTION_KEY || '').trim();
  check(
    report,
    'API_KEY_ENCRYPTION_KEY set',
    strict ? Boolean(encKey) : true,
    encKey ? 'configured' : 'missing (dev derivation OK locally)',
    'fd-prod-api-key-encryption'
  );

  const eligSlack = Boolean((process.env.ELIGIBILITY_ALERT_SLACK_WEBHOOK || '').trim());
  const paySlack = Boolean((process.env.PAYMENT_ALERT_SLACK_WEBHOOK || '').trim());
  check(
    report,
    'ELIGIBILITY_ALERT_SLACK_WEBHOOK',
    strict ? eligSlack : true,
    eligSlack ? 'configured' : 'unset',
    'fd-ops-strict-alerts-prod'
  );
  check(
    report,
    'PAYMENT_ALERT_SLACK_WEBHOOK',
    strict ? paySlack : true,
    paySlack ? 'configured' : 'unset',
    'fd-ops-strict-alerts-prod'
  );

  if (clinicId) {
    process.chdir(ROOT);
    try {
      const db = require('../database');
      if (db.db) {
        const clinic = db.db.prepare('SELECT shadow_week_active, pilot_live_at FROM clinics WHERE clinic_id = ?').get(clinicId);
        check(
          report,
          'shadow_week_active',
          clinic?.shadow_week_active === 1,
          clinic ? String(clinic.shadow_week_active) : 'clinic not found',
          'fd-pilot-shadow-week-execute'
        );
        check(
          report,
          'pilot_live_at unset during shadow',
          !clinic?.pilot_live_at || clinic.shadow_week_active === 1,
          clinic?.pilot_live_at || '(not live yet)',
          'fd-pilot-set-live-at'
        );

        const profile = db.db
          .prepare(`SELECT policy_json FROM prompt_profiles WHERE clinic_id = ? LIMIT 1`)
          .get(clinicId);
        let speak = null;
        if (profile?.policy_json) {
          try {
            speak = JSON.parse(profile.policy_json).copay_quote_speak_enabled;
          } catch (_) {}
        }
        check(
          report,
          'copay_quote_speak_enabled=0 (shadow)',
          speak === false || speak === 0 || speak === '0',
          `current=${speak}`,
          'fd-pilot-shadow-week-execute'
        );
      }
    } catch (e) {
      check(report, 'clinic DB checks', false, e.message, 'fd-pilot-shadow-week-execute');
    }
  } else {
    console.log('ℹ️  Pass --clinic-id for shadow-week DB checks\n');
  }

  const alerts = spawnSync('node', ['scripts/verify-ops-alerts-prod.cjs'], {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, STRICT: strict ? '1' : '0' }
  });
  if (strict && alerts.status !== 0) report.pass = false;

  if (truthy(process.env.CLOUDRUN_VERIFY)) {
    console.log('\n── Live Cloud Run (CLOUDRUN_VERIFY=1) ──\n');
    const cloud = spawnSync('node', ['scripts/verify-cloudrun-pilot-prod.cjs'], {
      cwd: ROOT,
      stdio: 'inherit',
      env: { ...process.env, STRICT: strict ? '1' : '0' }
    });
    if (strict && cloud.status !== 0) report.pass = false;
  }

  console.log('\n' + JSON.stringify({ pass: report.pass, strict, clinicId }, null, 2));
  if (!report.pass) {
    console.error('\nRun: npm run setup:phase2-prod-stedi -- --dry-run');
    console.error('     npm run setup:pilot-go-live -- --clinic-id <id>\n');
  }
  process.exit(report.pass ? 0 : 1);
}

main();
