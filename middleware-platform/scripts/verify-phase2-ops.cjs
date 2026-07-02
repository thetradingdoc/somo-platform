#!/usr/bin/env node
'use strict';

/**
 * Sprint B ops readiness check for Phase 2 dental pilot.
 * Usage: node scripts/verify-phase2-ops.cjs [--clinic-id clinic-default]
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const path = require('path');
process.chdir(path.join(__dirname, '..'));

const clinicId = process.argv.includes('--clinic-id')
  ? process.argv[process.argv.indexOf('--clinic-id') + 1]
  : process.env.TEST_CLINIC_ID || process.env.PHASE2_PILOT_CLINIC_ID || 'clinic-default';

const report = { clinicId, checks: [], ready: true };

function check(name, ok, detail) {
  report.checks.push({ name, ok, detail });
  if (!ok) report.ready = false;
  const icon = ok ? '✅' : '❌';
  console.log(`${icon} ${name}${detail ? `: ${detail}` : ''}`);
}

async function main() {
  console.log(`\n=== Phase 2 Sprint B Ops Check (clinic: ${clinicId}) ===\n`);

  const apiKey = (process.env.STEDI_API_KEY || '').trim();
  const simulate = String(process.env.VOICE_ELIGIBILITY_SIMULATE || '0').trim();
  const testMode = String(process.env.STEDI_TEST_MODE || '').trim() === '1';
  const hasProdKey = Boolean(apiKey && !apiKey.startsWith('test_'));

  check(
    'STEDI_API_KEY set',
    Boolean(apiKey),
    hasProdKey ? 'production key' : testMode ? 'test key (OK for Stedi sandbox)' : 'test or missing prod key'
  );
  check('VOICE_ELIGIBILITY_SIMULATE=0 for prod', simulate === '0', `current=${simulate || '(unset)'}`);

  try {
    const InsuranceService = require('../services/insurance-service');
    const mode = InsuranceService.getStediClaimSubmissionMode();
    check('STEDI_CLAIM_SUBMISSION_MODE=professional', mode === 'professional', `mode=${mode}`);
  } catch (e) {
    check('STEDI_CLAIM_SUBMISSION_MODE=professional', false, e.message);
  }

  const db = require('../database');
  if (db.db) {
    try {
      const ruleCount = db.db.prepare(`SELECT COUNT(*) AS n FROM plan_rules WHERE payer_id LIKE '%DENTAL%' OR payer_id LIKE 'DELTA_%' OR payer_id LIKE 'CIGNA_%'`).get();
      const n = ruleCount?.n || 0;
      check('dental plan_rules seeded', n >= 10, `${n} rules found (run: node seeds/dental-payer-rules.js)`);
    } catch (e) {
      check('dental plan_rules seeded', false, e.message);
    }

    try {
      const clinic =
        (await db.getClinicById?.(clinicId)) ||
        db.db?.prepare('SELECT clinic_id, merchant_id, name FROM clinics WHERE clinic_id = ?').get(clinicId);
      const merchantId = clinic?.merchant_id || null;
      check('clinic merchant_id configured', Boolean(merchantId), merchantId || 'missing — run Stripe Connect onboarding');
    } catch (e) {
      check('clinic merchant_id configured', false, e.message);
    }

    try {
      const { resolveTenantVoiceConfig } = require('../services/tenant-voice-config');
      const voiceCfg = await resolveTenantVoiceConfig(db, { clinicId });
      const speak = voiceCfg?.copay_quote_speak_enabled;
      check(
        'copay_quote_speak_enabled shadow default',
        speak === false || speak === 0 || speak === '0' || speak == null,
        `current=${speak} (0=shadow week, 1=live speak)`
      );
    } catch (e) {
      check('copay_quote_speak_enabled shadow default', false, e.message);
    }
  } else {
    check('database available', false, 'DB not initialized');
  }

  const npi = (
    process.env.STEDI_PROVIDER_NPI ||
    process.env.PROVIDER_NPI ||
    process.env.STEDI_TEST_PROVIDER_NPI ||
    ''
  ).trim();
  check(
    'provider NPI configured',
    Boolean(npi),
    npi ? (testMode ? `test NPI ${npi}` : 'set') : 'set STEDI_PROVIDER_NPI'
  );

  console.log('\n--- Sprint B actions if any checks failed ---');
  console.log('1. Set production STEDI_API_KEY on Render (not test_ prefix)');
  console.log('2. Set VOICE_ELIGIBILITY_SIMULATE=0 on production voice');
  console.log('3. node seeds/dental-payer-rules.js');
  console.log('4. Complete Stripe Connect → clinic merchant_id');
  console.log('5. Enroll NPI with Stedi per pilot payer');
  console.log('6. Keep copay_quote_speak_enabled=0 during shadow week\n');

  if (!report.ready) {
    console.error('❌ Sprint B ops not ready — fix failed checks above\n');
    process.exit(1);
  }
  console.log('✅ Sprint B ops checks passed for local/staging config\n');
}

main().catch((e) => {
  console.error('❌', e.message);
  process.exit(1);
});
