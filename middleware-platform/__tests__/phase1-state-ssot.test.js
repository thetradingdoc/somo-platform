'use strict';

jest.mock('../services/kelly-rails/lanes', () => ({
  executeLaneStep: jest.fn(async (state) => ({
    reply: 'done',
    toolsUsed: [],
    endCall: false,
    gate_matched: 'booking_done',
    gate_outcome: 'complete'
  }))
}));

const db = require('../database');
const KellyToolExecutor = require('../services/kelly-tool-executor');
const { hydrateFlagsFromDb } = require('../services/kelly-rails/hydrate');
const {
  persistRailsSessionState,
  getRailsSessionProjection,
  mirrorMetaFromPayload
} = require('../services/kelly-rails/session-ssot');
const { loadConversationSession } = require('../services/conversation-mode/conversation-mode-session');
const { readFrontDeskState } = require('../services/front-desk-intake');
const { laneToOrchestratorPhase } = require('../services/kelly-rails/lane-orchestrator-phase');
const { executeTurn } = require('../services/kelly-rails/execute-turn');

describe('phase1 state SSOT', () => {
  test('1.4 hydrateFlagsFromDb — projection wins over stale meta_kv', () => {
    const sid = `hydrate-proj-${Date.now()}`;
    persistRailsSessionState(sid, {
      active_lane: 'clinical',
      step: 'symptoms',
      flags: { payment_complete: true, safety_blocked: false }
    });
    KellyToolExecutor._setSessionMeta(sid, 'payment_complete', '0');
    KellyToolExecutor._setSessionMeta(sid, 'safety_blocked', '1');
    const flags = hydrateFlagsFromDb(sid, null);
    expect(flags.payment_complete).toBe(true);
    expect(flags.safety_blocked).toBe(false);
  });

  test('1.5 loadConversationSession uses hydrate path (triage + projection)', () => {
    const sid = `load-conv-${Date.now()}`;
    persistRailsSessionState(sid, {
      active_lane: 'booking',
      step: 'schedule_visit',
      flags: { conversation_mode: 'tenant_inbound_admin', active_subrail: 'booking' }
    });
    db.upsertTriageSession({
      session_id: sid,
      patient_id: 'Patient/test',
      target_specialty: 'Dermatology',
      triage_complete: 1
    });
    const session = loadConversationSession(sid, db);
    expect(session.active_lane).toBe('booking');
    expect(session.conversation_mode).toBe('tenant_inbound_admin');
    expect(session.triage_complete).toBe(true);
    expect(session.target_specialty).toBe('Dermatology');
    db.db?.prepare('DELETE FROM triage_sessions WHERE session_id = ?').run(sid);
  });

  test('1.6 front-desk intake reads fd_* from projection SSOT', () => {
    const sid = `fd-intake-${Date.now()}`;
    persistRailsSessionState(sid, {
      active_lane: 'basic_intake',
      step: 'identity',
      flags: { fd_full_name: 'Jane Doe', fd_phone: '+15551234567' }
    });
    KellyToolExecutor._setSessionMeta(sid, 'fd_full_name', 'Stale Name');
    const state = readFrontDeskState(sid);
    expect(state.full_name).toBe('Jane Doe');
    expect(state.phone).toBe('+15551234567');
  });

  test('1.8 mirrorMetaFromPayload mirrors gate flags mid-turn', () => {
    const sid = `mirror-meta-${Date.now()}`;
    mirrorMetaFromPayload(sid, {
      last_appointment_id: 'appt-99',
      opqrst_resume_field: 'quality',
      payment_complete: true,
      copay_amount: 25
    });
    expect(KellyToolExecutor._getSessionMeta(sid, 'last_appointment_id')).toBe('appt-99');
    expect(KellyToolExecutor._getSessionMeta(sid, 'opqrst_resume_field')).toBe('quality');
    expect(KellyToolExecutor._getSessionMeta(sid, 'payment_complete')).toBe('1');
    expect(KellyToolExecutor._getSessionMeta(sid, 'copay_amount')).toBe('25');
  });

  test('1.13 laneToOrchestratorPhase single shared mapping', () => {
    expect(laneToOrchestratorPhase('clinical')).toBe('TRIAGE_ACTIVE');
    expect(laneToOrchestratorPhase('booking')).toBe('BOOKING');
    expect(laneToOrchestratorPhase('unknown_lane')).toBe('TRIAGE_DISCOVERY');
  });

  test('1.2 remapped done→await_intent persists to projection', async () => {
    const sid = `remap-step-${Date.now()}`;
    await executeTurn({
      sessionId: sid,
      message: 'thanks',
      active_lane: 'router',
      step: 'done',
      flags: { schedule_appointment_success: true },
      v2_hydrated: true,
      conversation_mode: 'tenant_inbound_admin'
    });
    const row = getRailsSessionProjection(sid);
    expect(row?.step).not.toBe('done');
    // Remap may land on router await_intent, booking confirm, post-payment confirmation,
    // support handoff, or basic_intake identity depending on lane handoff order.
    expect([
      'await_intent',
      'confirm_visit',
      'confirmation',
      'handoff',
      'identity'
    ]).toContain(row?.step);
  });
});

describe('phase1 shadow pivot no projection write (1.12)', () => {
  const prevRouting = process.env.CONVERSATION_MODE_ROUTING;

  afterEach(() => {
    process.env.CONVERSATION_MODE_ROUTING = prevRouting;
  });

  test('shadow mode does not persist pivot to projection', () => {
    process.env.CONVERSATION_MODE_ROUTING = 'shadow';
    const sid = `shadow-pivot-${Date.now()}`;
    persistRailsSessionState(sid, {
      active_lane: 'clinical',
      step: 'symptoms',
      flags: { conversation_mode: 'tenant_inbound_clinical', active_subrail: 'opqrst' }
    });
    const { processConversationTurn } = require('../services/conversation-mode/conversation-mode-session');
    processConversationTurn({
      sessionId: sid,
      db,
      message: 'I need to pay my copay',
      clinicId: 'clinic-1',
      customerId: 'cust-1',
      tenantPolicy: { billing_enabled: true, records_enabled: true, triage_policy: 'conditional' }
    });
    const row = getRailsSessionProjection(sid);
    const flags = JSON.parse(row.flags_json);
    expect(flags.conversation_mode).toBe('tenant_inbound_clinical');
  });
});
