#!/usr/bin/env node
'use strict';

/**
 * Reproduce booking dead-end: logs lane/step/flags/tools per turn.
 * Usage: node scripts/debug-booking-deadend.cjs [--cold] [--seeded]
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const path = require('path');
const MP = path.join(__dirname, '..');
process.chdir(MP);

process.env.KELLY_RAILS_V2 = process.env.KELLY_RAILS_V2 || '1';
process.env.KELLY_RAILS_ROLLOUT_PCT = process.env.KELLY_RAILS_ROLLOUT_PCT || '1';
process.env.CONVERSATION_MODE_ROUTING = process.env.CONVERSATION_MODE_ROUTING || 'enforce';
process.env.KELLY_E2E_SKIP_TRIAGE = process.env.KELLY_E2E_SKIP_TRIAGE || '1';
process.env.RCM_E2E_DIRECT_TOOLS = process.env.RCM_E2E_DIRECT_TOOLS || '1';
process.env.DB_PATH = process.env.DB_PATH || path.join(MP, 'middleware-dev.db');

const fixtures = require('../lib/kelly-conversation-fixtures.cjs');
const { runKellyTurn } = require('../services/kelly/kelly-turn-resolver');
const { seedModeAtCallStart } = require('../services/conversation/conversation-mode-session');
const { getRailsSessionProjection } = require('../services/kelly/rails/session-ssot');
const crypto = require('crypto');

const KellyToolExecutor = require('../services/kelly/kelly-tool-executor');

function ensurePatient(opts = {}) {
  const { dbModule } = fixtures.loadDb();
  const phone = opts.phone || `+1555${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;
  let patient = dbModule.getFHIRPatientByPhone?.(phone);
  if (!patient) {
    const resourceId = `Patient/sandbox-${crypto.randomBytes(4).toString('hex')}`;
    dbModule.createFHIRPatient({
      resourceType: 'Patient',
      id: resourceId,
      name: [{ given: [opts.given || 'Sandbox'], family: opts.family || 'Patient' }],
      telecom: [
        { system: 'phone', value: phone },
        { system: 'email', value: opts.email || `sandbox-${crypto.randomBytes(4).toString('hex')}@somo.test` }
      ]
    });
    patient = dbModule.getFHIRPatient(resourceId);
  }
  const name = opts.name || `${opts.given || 'Sandbox'} ${opts.family || 'Patient'}`;
  return {
    patientId: patient.resource_id,
    patientName: name,
    patientPhone: phone,
    patientEmail: opts.email || patient.telecom?.find((t) => t.system === 'email')?.value || 'sandbox@somo.test'
  };
}

const CLINIC_ID = process.env.TEST_CLINIC_ID || 'clinic-default';
const ADMIN_TENANT_POLICY = { triage_policy: 'conditional', billing_enabled: true, records_enabled: true };
const mode = process.argv.includes('--cold') ? 'cold' : process.argv.includes('--seeded') ? 'seeded' : 'user';

function seedAdminBookingPath(sessionId, patient, clinicId) {
  fixtures.seedBookingReady(sessionId, patient.patientId, clinicId, {
    patientName: patient.patientName,
    patientEmail: patient.patientEmail,
    patientPhone: patient.patientPhone,
    targetSpecialty: 'Dermatology',
    symptomText: 'routine dermatology visit',
    quality: 'routine visit',
    region: 'general'
  });
  const { persistRailsSessionState } = require('../services/kelly/rails/session-ssot');
  persistRailsSessionState(sessionId, {
    active_lane: 'booking',
    step: 'schedule_visit',
    conversation_mode: 'tenant_inbound_admin',
    active_subrail: 'booking',
    flags: {
      conversation_mode: 'tenant_inbound_admin',
      active_subrail: 'booking',
      active_subrail_step: 'slot_lookup',
      triage_complete: true,
      has_rag: true
    }
  });
  fixtures.setMeta(sessionId, 'kelly_e2e_skip_triage', '1');
  fixtures.setMeta(sessionId, 'kelly_orchestrator_phase', 'BOOKING');
}

function snapshot(sessionId) {
  let flags = {};
  let p = null;
  try {
    p = getRailsSessionProjection(sessionId);
    if (p?.flags_json) flags = JSON.parse(p.flags_json);
  } catch (_) {}
  return {
    lane: p?.active_lane,
    step: p?.step,
    subrail: p?.active_subrail,
    subrail_step: flags.active_subrail_step,
    no_provider_availability: flags.no_provider_availability,
    booking_conflict: flags.booking_conflict,
    provider_mismatch: flags.provider_mismatch,
    current_booking_slot: flags.current_booking_slot,
    last_slot_date: KellyToolExecutor._getSessionMeta(sessionId, 'last_slot_date'),
    last_slot_time: KellyToolExecutor._getSessionMeta(sessionId, 'last_slot_time'),
    last_slot_id: KellyToolExecutor._getSessionMeta(sessionId, 'last_slot_id'),
    last_schedule_error: flags.last_schedule_error
  };
}

function dialogs() {
  const userDialog = [
    'Hi, I need to book a dermatology appointment for next week.',
    '12:00 with Dr. Maria Santos works for me.',
    'Yes please book that slot.',
    'My name is Book Test, email book-sandbox@somo.test, phone +15559904030.',
    'Yes go ahead and confirm the booking please.'
  ];
  const userDialogV2 = [
    'Hi, I need to book a dermatology appointment for next week.',
    'What appointment times do you have available this week?',
    '12:00 with Dr. Maria Santos works for me.',
    'Yes please book that slot.',
    'My name is Book Test, email book-sandbox@somo.test, phone +15551197824.',
    'Yes go ahead and confirm the booking please.'
  ];
  if (mode === 'cold') return { label: 'cold-start (no seed)', dialog: userDialog };
  if (mode === 'seeded') return { label: 'seeded admin path + user dialog', dialog: userDialog };
  return { label: 'seeded + availability question', dialog: userDialogV2 };
}

async function main() {
  const { label, dialog } = dialogs();
  const patient = ensurePatient({
    given: 'Book',
    family: 'Test',
    email: 'book-sandbox@somo.test',
    phone: '+15559904030'
  });
  const sessionId = fixtures.newE2eSessionId('debug_book');
  console.log(`\n=== Booking dead-end repro: ${label} ===`);
  console.log(`session=${sessionId} patient=${patient.patientId}\n`);

  fixtures.seedE2eBookableProvider(CLINIC_ID, { targetSpecialty: 'Dermatology' });

  seedModeAtCallStart({
    sessionId,
    clinicId: CLINIC_ID,
    call_type: 'tenant',
    direction: 'inbound',
    firstUtterance: dialog[0],
    tenantResolved: true,
    tenantPolicy: ADMIN_TENANT_POLICY
  });

  if (mode !== 'cold') {
    seedAdminBookingPath(sessionId, patient, CLINIC_ID);
    // Intentionally NOT setting slot meta — reproduces wiped-meta / empty-slots path
  }

  for (let i = 0; i < dialog.length; i++) {
    const msg = dialog[i];
    fixtures.seedE2eBookableProvider(CLINIC_ID, { targetSpecialty: 'Dermatology' });
    const before = snapshot(sessionId);
    const out = await runKellyTurn({
      sessionId,
      clinicId: CLINIC_ID,
      patientId: patient.patientId,
      patientName: patient.patientName,
      callerPhone: patient.patientPhone,
      channel: 'voice',
      message: msg,
      call_type: 'tenant',
      direction: 'inbound',
      tenantPolicy: ADMIN_TENANT_POLICY
    });
    const after = snapshot(sessionId);
    console.log(`T${i + 1} patient: ${msg}`);
    console.log(`     kelly:  ${out?.reply || '(empty)'}`);
    console.log(`     tools:  ${(out?.toolsUsed || []).join(', ') || '(none)'}`);
    console.log(`     lane/step: ${out?.kelly_rails?.active_lane}/${out?.kelly_rails?.step}`);
    console.log(`     flags: no_avail=${after.no_provider_availability} conflict=${after.booking_conflict} mismatch=${after.provider_mismatch}`);
    console.log(`     slot meta: date=${after.last_slot_date} time=${after.last_slot_time} id=${after.last_slot_id}`);
    if (after.last_schedule_error) console.log(`     last_schedule_error: ${after.last_schedule_error}`);
    console.log('---');
  }

  const slotsProbe = await KellyToolExecutor.execute(
    'get_available_slots',
    { specialty: 'Dermatology', days_ahead: 14 },
    { sessionId, clinicId: CLINIC_ID, patientId: patient.patientId, callerPhone: patient.patientPhone }
  );
  const bundles = Array.isArray(slotsProbe?.slot_bundles) ? slotsProbe.slot_bundles : [];
  console.log(`\nDirect get_available_slots probe: ${bundles.length} bundles`);
  if (slotsProbe?.error) console.log(`  error: ${slotsProbe.error}`);
  if (bundles.length) console.log(`  sample: ${JSON.stringify(bundles[0])}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
