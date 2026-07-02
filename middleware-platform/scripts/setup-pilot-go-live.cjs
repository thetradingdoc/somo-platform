#!/usr/bin/env node
'use strict';

/**
 * Pilot go-live helper — shadow week setup + manual checklist for office #1.
 *
 * Usage: node scripts/setup-pilot-go-live.cjs --clinic-id <id>
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { spawnSync } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const REPO = path.join(ROOT, '..');

const clinicId = process.argv.includes('--clinic-id')
  ? process.argv[process.argv.indexOf('--clinic-id') + 1]
  : process.env.PHASE2_PILOT_CLINIC_ID;

function main() {
  if (!clinicId) {
    console.error('Usage: npm run setup:pilot-go-live -- --clinic-id <clinic_id>');
    process.exit(1);
  }

  console.log(`\n=== Pilot Go-Live Setup (clinic: ${clinicId}) ===\n`);

  console.log('── Step 1: Enable shadow week (local DB) ──\n');
  const shadow = spawnSync('node', ['scripts/setup-phase2-shadow-week.cjs', '--clinic-id', clinicId], {
    cwd: ROOT,
    stdio: 'inherit'
  });
  if (shadow.status !== 0) {
    console.error('❌ setup-phase2-shadow-week failed');
    process.exit(1);
  }

  console.log('\n── Step 2: Manual checklist (fd-pilot-* todos) ──\n');
  const manual = [
    ['fd-pilot-send-invite', 'Admin pipeline → Send pilot invite; provider opens /business/invite.html?code=…'],
    ['fd-pilot-voice-setup-complete', 'Provider finishes voice-setup Step 1 (address, PMS, transfer #, NPI, hours)'],
    ['fd-pilot-pstn-test-call', 'Place test call from voice-setup; confirm Kelly answers'],
    ['fd-pilot-forward-main-line', 'Forward practice main line to Kelly Twilio number'],
    ['fd-pilot-shadow-week-execute', 'Shadow week on live calls — compare desk vs amount_resolution_log'],
    ['fd-pilot-copay-desk-parity', 'npm run verify:pilot-copay-desk-parity -- --clinic-id ' + clinicId],
    ['fd-pilot-enable-copay-speak', `npm run setup:pilot-live -- --clinic-id ${clinicId} (after shadow passes)`],
    ['fd-pilot-set-live-at', `Included in setup:pilot-live — sets pilot_live_at + clears shadow_week_active`]
  ];
  for (const [id, text] of manual) {
    console.log(`  [ ] ${id}: ${text}`);
  }

  console.log('\n── Verify ──\n');
  console.log(`  npm run verify:pilot-prod-readiness -- --clinic-id ${clinicId}`);
  console.log('  PILOT_PROD_STRICT=1 npm run verify:pilot-prod-readiness');
  console.log('\nDocs:');
  console.log(`  ${path.join(REPO, 'docs/voice-agent/phase4-pilot-checklist.md')}`);
  console.log(`  ${path.join(REPO, 'docs/voice-agent/SHADOW_WEEK_RUNBOOK.md')}\n`);
}

main();
