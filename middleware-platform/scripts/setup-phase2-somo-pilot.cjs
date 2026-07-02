#!/usr/bin/env node
'use strict';

/**
 * Configure Somo Health Navigator for Phase 2 dental copay pilot.
 * Usage: node scripts/setup-phase2-somo-pilot.cjs [--clinic-id <id>]
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { TriagePolicy } = require('../services/conversation-mode/tenant-policy');
const { seed: seedDentalRules } = require('../seeds/dental-payer-rules');

const SOMO_CLINIC_ID = 'clinic-da8523ab-ab4b-4da8-b9c0-4694850a3f34';
const SOMO_MERCHANT_ID = 'merchant-49094191-9fb1-4e81-9bb0-0543684e5e96';

function argClinicId() {
  const idx = process.argv.indexOf('--clinic-id');
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  return process.env.PHASE2_PILOT_CLINIC_ID || SOMO_CLINIC_ID;
}

function main() {
  process.chdir(path.join(__dirname, '..'));
  const db = require('../database');
  if (!db.db) throw new Error('Database not available');

  const clinicId = argClinicId();
  const clinic = db.db.prepare('SELECT * FROM clinics WHERE clinic_id = ?').get(clinicId);
  if (!clinic) throw new Error(`Clinic not found: ${clinicId}`);

  console.log(`\n=== Phase 2 pilot setup: ${clinic.name} (${clinicId}) ===\n`);

  seedDentalRules();
  console.log('✅ dental plan_rules seeded');

  const profileId = `prof_phase2_dental_${clinicId}`;
  db.db.prepare(`
    INSERT OR REPLACE INTO prompt_profiles (
      id, clinic_id, customer_id, name, specialty, system_prompt, allowed_tools,
      status, use_case, policy_json, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, datetime('now'))
  `).run(
    profileId,
    clinicId,
    null,
    'Somo Dental Phase 2',
    'Dental',
    'Front-desk dental voice agent — copay pilot.',
    JSON.stringify([
      'collect_insurance',
      'request_patient_payment',
      'schedule_appointment',
      'create_appointment_checkout'
    ]),
    'dental',
    JSON.stringify({
      triage_policy: TriagePolicy.DISABLED,
      copay_quote_speak_enabled: false
    })
  );
  console.log('✅ dental prompt_profile (triage disabled, copay shadow)');

  const existingVas = db.db
    .prepare('SELECT id FROM voice_agent_settings WHERE clinic_id = ? LIMIT 1')
    .get(clinicId);
  if (existingVas?.id) {
    db.db.prepare(`UPDATE voice_agent_settings SET updated_at = datetime('now') WHERE id = ?`).run(
      existingVas.id
    );
    console.log('✅ voice_agent_settings row exists for clinic');
  } else {
    const vasId = `vas_${uuidv4()}`;
    db.db.prepare(`
      INSERT INTO voice_agent_settings (
        id, merchant_id, clinic_id, enabled, greeting, settings_version, sync_status, updated_at
      ) VALUES (?, ?, ?, 1, ?, 1, 'pending', datetime('now'))
    `).run(
      vasId,
      clinic.merchant_id || SOMO_MERCHANT_ID,
      clinicId,
      `Thank you for calling ${clinic.name}. How can I help you today?`
    );
    console.log('✅ voice_agent_settings row created');
  }

  const merchant = db.db
    .prepare('SELECT id, name, status FROM merchants WHERE id = ?')
    .get(clinic.merchant_id);
  console.log(
    merchant
      ? `✅ merchant ${merchant.id} (${merchant.status})`
      : `⚠️  merchant missing for clinic — complete Stripe Connect`
  );

  console.log('\nDone. Run: npm run verify:phase2-ops -- --clinic-id', clinicId, '\n');
}

main();
