#!/usr/bin/env node
'use strict';

/**
 * Exit shadow week and mark pilot live on a clinic.
 *
 * Usage: node scripts/setup-pilot-live.cjs --clinic-id <id>
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const path = require('path');
const {
  setCopayQuoteSpeakEnabled,
  setVoiceReplySuppressEnabled
} = require('../services/tenant-voice-config');

const clinicId = process.argv.includes('--clinic-id')
  ? process.argv[process.argv.indexOf('--clinic-id') + 1]
  : process.env.PHASE2_PILOT_CLINIC_ID;

function main() {
  if (!clinicId) {
    console.error('Usage: npm run setup:pilot-live -- --clinic-id <clinic_id>');
    process.exit(1);
  }

  process.chdir(path.join(__dirname, '..'));
  const db = require('../database');
  if (!db.db) throw new Error('DB unavailable');

  const clinic = db.db.prepare('SELECT clinic_id, name FROM clinics WHERE clinic_id = ?').get(clinicId);
  if (!clinic) throw new Error(`Clinic not found: ${clinicId}`);

  console.log(`\n=== Pilot live exit (clinic: ${clinic.name}) ===\n`);

  setCopayQuoteSpeakEnabled(db, clinicId, true);
  console.log('✅ copay_quote_speak_enabled=1');

  setVoiceReplySuppressEnabled(db, clinicId, false);
  console.log('✅ voice_reply_suppress_enabled=0');

  const liveAt = new Date().toISOString();
  db.updateClinic?.(clinicId, { shadow_week_active: 0, pilot_live_at: liveAt });
  console.log(`✅ shadow_week_active=0, pilot_live_at=${liveAt}`);

  console.log('\n── Next steps ──\n');
  console.log('  1. Provider enables Kelly on agent.html (PATCH /api/kelly/toggle)');
  console.log(`  2. npm run verify:pilot-prod-readiness -- --clinic-id ${clinicId}`);
  console.log('  3. npm run verify:live-copay-call -- --session <session_id> after a copay PSTN call');
  console.log('\nDocs: docs/voice-agent/SHADOW_WEEK_RUNBOOK.md\n');
}

main();
