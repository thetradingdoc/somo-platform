#!/usr/bin/env node
'use strict';

/**
 * E2E — OPQRST traffic controller (Problem 2 freeze).
 * Runs multi-turn voice dialog via runKellyTurn (production path).
 *
 * Usage:
 *   node scripts/opqrst/opqrst-freeze-e2e.cjs
 *   OPQRST_FIELD_GATE_ENABLED=0 node scripts/opqrst/opqrst-freeze-e2e.cjs  # rollback check
 */

const path = require('path');
const crypto = require('crypto');

require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const MP = path.join(__dirname, '..', '..');
process.chdir(MP);

process.env.KELLY_RAILS_V2 = process.env.KELLY_RAILS_V2 || '1';
process.env.KELLY_RAILS_ROLLOUT_PCT = process.env.KELLY_RAILS_ROLLOUT_PCT || '1';
process.env.CONVERSATION_MODE_ROUTING = process.env.CONVERSATION_MODE_ROUTING || 'enforce';
process.env.OPQRST_FIELD_GATE_ENABLED = process.env.OPQRST_FIELD_GATE_ENABLED ?? '1';
process.env.DB_PATH = process.env.DB_PATH || path.join(MP, 'middleware-dev.db');

const { isOpqrstFieldGateEnabled } = require('../../services/kelly/rails/config');
const { runKellyTurn } = require('../../services/kelly/kelly-turn-resolver');
const { seedModeAtCallStart } = require('../../services/conversation/conversation-mode-session');
const { getRailsSessionProjection } = require('../../services/kelly/rails/session-ssot');
const db = require('../../database');

const CLINIC_ID =
  process.env.TEST_CLINIC_ID ||
  process.env.DEFAULT_CLINIC_ID ||
  process.env.PRIMARY_CLINIC_ID ||
  'clinic-default';
const CUSTOMER_ID =
  process.env.CALLSOMO_OPERATOR_CUSTOMER_ID ||
  process.env.CAPSTONE_CUSTOMER_ID ||
  process.env.TEST_CUSTOMER_ID ||
  null;

const DIALOG = [
  { label: 'symptom opener', message: 'Hi, I have a painful rash on my leg that started three days ago.' },
  { label: 'quality + severity', message: 'It is itchy and red, about a five out of ten.' },
  { label: 'booking interrupt (must queue, not pivot)', message: 'Actually I want to book an appointment for tomorrow please.' },
  { label: 'resume OPQRST', message: 'It gets worse when I scratch it.' },
  { label: 'complete OPQRST', message: 'The pain stays in my leg only, constant, still about five out of ten.' }
];

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function loadFlags(sessionId) {
  try {
    const projection = getRailsSessionProjection(sessionId);
    if (projection?.flags_json) return JSON.parse(projection.flags_json);
  } catch (_) {}
  return {};
}

function snapshot(sessionId, out) {
  const flags = loadFlags(sessionId);
  const triage = db.getTriageSession?.(sessionId) || null;
  return {
    mode: out?.conversation_mode || flags.conversation_mode,
    subrail: out?.active_subrail || flags.active_subrail,
    lane: out?.kelly_rails?.active_lane,
    step: out?.kelly_rails?.step,
    opqrst_in_progress: !!(flags.opqrst_in_progress || out?.kelly_rails?.flags?.opqrst_in_progress),
    openField: flags._opqrst_gate?.openField || out?.kelly_rails?.flags?._opqrst_gate?.openField,
    pending_queue: flags.pending_intent_queue || [],
    triage_onset: triage?.onset || null,
    triage_quality: triage?.quality || null,
    triage_provocation: triage?.provocation || null
  };
}

async function main() {
  const gateEnv = process.env.OPQRST_FIELD_GATE_ENABLED;
  const gateOn = isOpqrstFieldGateEnabled();
  console.log('═'.repeat(72));
  console.log('OPQRST freeze E2E — runKellyTurn (voice, production path)');
  console.log('═'.repeat(72));
  console.log(`OPQRST_FIELD_GATE_ENABLED env: ${gateEnv === undefined ? '(unset → default 1)' : JSON.stringify(gateEnv)}`);
  console.log(`isOpqrstFieldGateEnabled(): ${gateOn}`);
  console.log(`CONVERSATION_MODE_ROUTING: ${process.env.CONVERSATION_MODE_ROUTING}`);
  console.log(`DB_PATH: ${process.env.DB_PATH}`);
  console.log(`CLINIC_ID: ${CLINIC_ID}`);
  console.log(`CUSTOMER_ID: ${CUSTOMER_ID || '(missing — identity admission will fail)'}`);
  console.log('');

  if (!CUSTOMER_ID) {
    console.error('❌ Set CALLSOMO_OPERATOR_CUSTOMER_ID or TEST_CUSTOMER_ID for tenant identity admission.');
    process.exit(2);
  }

  if (!gateOn) {
    console.warn('⚠️  Gate is OFF — OPQRST freeze behavior will not apply. Set OPQRST_FIELD_GATE_ENABLED=1');
  }

  const sessionId = `opqrst_freeze_e2e_${crypto.randomBytes(4).toString('hex')}`;
  const fixtures = require('../lib/kelly-conversation-fixtures.cjs');
  const patient = (() => {
    const { dbModule } = fixtures.loadDb();
    const phone = `+1555${crypto.randomInt(1000000, 9999999)}`;
    const resourceId = `Patient/e2e-freeze-${crypto.randomBytes(4).toString('hex')}`;
    dbModule.createFHIRPatient({
      resourceType: 'Patient',
      id: resourceId,
      name: [{ given: ['E2E'], family: ['Freeze'] }],
      telecom: [{ system: 'phone', value: phone }, { system: 'email', value: 'e2e-freeze@somo.test' }]
    });
    const row = dbModule.getFHIRPatient(resourceId);
    return {
      patientId: row.resource_id,
      patientName: 'E2E Freeze',
      patientPhone: phone,
      patientEmail: 'e2e-freeze@somo.test'
    };
  })();

  seedModeAtCallStart({
    sessionId,
    clinicId: CLINIC_ID,
    customerId: CUSTOMER_ID,
    call_type: 'tenant',
    direction: 'inbound',
    firstUtterance: DIALOG[0].message,
    tenantResolved: true
  });

  const turns = [];
  let out = null;

  for (const step of DIALOG) {
    console.log(`\n▶ ${step.label}`);
    console.log(`  user: ${step.message}`);
    out = await runKellyTurn({
      sessionId,
      clinicId: CLINIC_ID,
      customerId: CUSTOMER_ID,
      patientId: patient.patientId,
      patientName: patient.patientName,
      callerPhone: patient.patientPhone,
      channel: 'voice',
      message: step.message,
      call_type: 'tenant',
      direction: 'inbound',
      site_context_status: 'verified',
      routing_world: 'tenant',
      callId: sessionId
    });
    const snap = snapshot(sessionId, out);
    turns.push({ ...step, reply: out?.reply || '', snap });
    console.log(`  Kelly: ${(out?.reply || '').slice(0, 160)}${(out?.reply || '').length > 160 ? '…' : ''}`);
    console.log(`  state: ${JSON.stringify(snap)}`);
  }

  const bookingTurn = turns[2];
  const resumeTurn = turns[3];
  const completeTurn = turns[4];

  const checks = [];

  try {
    assert(gateOn, 'gate must be enabled for freeze (OPQRST_FIELD_GATE_ENABLED=1)');
    checks.push('gate_enabled');

    assert(
      turns[0].snap.mode === 'tenant_inbound_clinical' || turns[0].snap.lane === 'clinical',
      `turn1 should enter clinical; got mode=${turns[0].snap.mode} lane=${turns[0].snap.lane}`
    );
    checks.push('clinical_entry');

    assert(
      bookingTurn.snap.pending_queue.includes('book') ||
        bookingTurn.snap.pending_queue.some((i) => String(i).toLowerCase().includes('book')),
      `booking interrupt should queue book intent; queue=${JSON.stringify(bookingTurn.snap.pending_queue)}`
    );
    checks.push('booking_queued');

    assert(
      bookingTurn.snap.mode === 'tenant_inbound_clinical',
      `booking interrupt must stay clinical; got mode=${bookingTurn.snap.mode}`
    );
    checks.push('booking_interrupt_stays_clinical');

    assert(
      bookingTurn.snap.subrail === 'opqrst' || bookingTurn.snap.opqrst_in_progress,
      `booking interrupt must stay on opqrst; subrail=${bookingTurn.snap.subrail} in_progress=${bookingTurn.snap.opqrst_in_progress}`
    );
    checks.push('booking_interrupt_stays_opqrst');

    assert(
      bookingTurn.snap.lane !== 'booking',
      `booking interrupt must not jump to booking lane; lane=${bookingTurn.snap.lane}`
    );
    checks.push('no_booking_lane_jump');

    assert(
      resumeTurn.snap.mode === 'tenant_inbound_clinical',
      `resume turn must stay clinical; mode=${resumeTurn.snap.mode}`
    );
    checks.push('resume_stays_clinical');

    const triageAfterResume = db.getTriageSession?.(sessionId);
    assert(!!triageAfterResume?.onset, 'onset should be stored in triage');
    assert(
      !!triageAfterResume?.provocation || resumeTurn.snap.triage_provocation,
      'provocation should be stored after resume turn'
    );
    checks.push('triage_provocation_stored');

    assert(
      resumeTurn.snap.openField === 'provocation' ||
        resumeTurn.snap.subrail === 'opqrst' ||
        resumeTurn.snap.opqrst_in_progress,
      `resume should stay in opqrst flow; openField=${resumeTurn.snap.openField}`
    );
    checks.push('resume_opqrst_field');

    assert(
      completeTurn.snap.mode === 'tenant_inbound_clinical',
      `turn5 must stay clinical before triage complete; mode=${completeTurn.snap.mode}`
    );
    checks.push('complete_turn_stays_clinical');

    assert(
      completeTurn.snap.opqrst_in_progress ||
        completeTurn.snap.subrail === 'opqrst',
      `turn5 must stay in opqrst; in_progress=${completeTurn.snap.opqrst_in_progress} subrail=${completeTurn.snap.subrail}`
    );
    checks.push('complete_turn_stays_opqrst');

    assert(
      completeTurn.snap.pending_queue.includes('book') ||
        completeTurn.snap.pending_queue.some((i) => String(i).toLowerCase().includes('book')),
      `turn5 must keep book queued; queue=${JSON.stringify(completeTurn.snap.pending_queue)}`
    );
    checks.push('complete_turn_book_still_queued');

    const queueBeforeDrain =
      resumeTurn.snap.pending_queue.length > 0
        ? resumeTurn.snap.pending_queue
        : bookingTurn.snap.pending_queue;
    assert(
      queueBeforeDrain.includes('book') ||
        queueBeforeDrain.some((i) => String(i).toLowerCase().includes('book')),
      `book intent should remain queued before triage complete; queue=${JSON.stringify(queueBeforeDrain)}`
    );
    checks.push('booking_queued_before_drain');

    const { drainPendingIntentsForAppointment } = require('../../services/conversation/conversation-mode-session');
    const flagsBeforeDrain = loadFlags(sessionId);
    const queue = [...queueBeforeDrain];
    const drainedSession = drainPendingIntentsForAppointment(
      {
        session_id: sessionId,
        pending_intent_queue: [...queue],
        completed_intents: flagsBeforeDrain.completed_intents || [],
        conversation_mode: 'tenant_inbound_clinical',
        active_subrail: 'opqrst'
      },
      { triage_complete: true, has_rag: true }
    );
    assert(
      drainedSession.kelly_lane_hint === 'booking' ||
        drainedSession.active_subrail === 'booking' ||
        !(drainedSession.pending_intent_queue || []).some((i) => String(i).toLowerCase().includes('book')),
      `queued book should drain on triage_complete; session=${JSON.stringify({
        lane: drainedSession.kelly_lane_hint,
        subrail: drainedSession.active_subrail,
        queue: drainedSession.pending_intent_queue
      })}`
    );
    checks.push('queued_book_drained');

    console.log('\n' + '═'.repeat(72));
    console.log('✅ OPQRST freeze E2E PASSED');
    console.log(JSON.stringify({ ok: true, sessionId, checks, turns: turns.map((t) => ({ label: t.label, snap: t.snap })) }, null, 2));
    process.exit(0);
  } catch (e) {
    console.error('\n' + '═'.repeat(72));
    console.error('❌ OPQRST freeze E2E FAILED:', e.message);
    console.error(JSON.stringify({ ok: false, sessionId, checks, error: e.message, turns: turns.map((t) => ({ label: t.label, snap: t.snap, reply: t.reply?.slice(0, 120) })) }, null, 2));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('❌ fatal:', e);
  process.exit(1);
});
