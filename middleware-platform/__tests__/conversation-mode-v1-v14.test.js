'use strict';

const { resolveConversationMode } = require('../services/conversation-mode/conversation-mode-resolver');
const { evaluateTurn, applyPivotToSession } = require('../services/conversation-mode/pivot-engine');
const { isToolAllowedForMode } = require('../services/conversation-mode/mode-tool-firewall');
const { handleCancellationSubrail } = require('../services/conversation-mode/subrails/cancellation-subrail');
const { handleOpqrstSubrail } = require('../services/conversation-mode/subrails/opqrst-subrail');

describe('conversation mode acceptance V1–V14', () => {
  test('V1 somo_demo mode resolves to demo_qual', () => {
    const out = resolveConversationMode({ call_type: 'somo_demo', direction: 'inbound', tenantPolicy: {} });
    expect(out.mode).toBe('demo_qual');
    expect(isToolAllowedForMode('store_triage_opqrst', { mode: out.mode })).toBe(false);
  });

  test('V2 sales_outbound mode resolves outbound_sales', () => {
    const out = resolveConversationMode({ call_type: 'sales_outbound', direction: 'outbound', tenantPolicy: {} });
    expect(out.mode).toBe('outbound_sales');
    expect(isToolAllowedForMode('schedule_appointment', { mode: out.mode })).toBe(false);
  });

  test('V3 operator_outbound blocks clinical tools', () => {
    const out = resolveConversationMode({ call_type: 'operator_outbound', direction: 'outbound', tenantPolicy: {} });
    expect(out.mode).toBe('operator_outbound');
    expect(isToolAllowedForMode('store_triage_opqrst', { mode: out.mode })).toBe(false);
  });

  test('V4 admin booking without OPQRST when triage disabled', () => {
    const out = resolveConversationMode({
      call_type: 'inbound_tenant',
      direction: 'inbound',
      tenantPolicy: { triage_policy: 'disabled', billing_enabled: true, records_enabled: true },
      firstUtterance: 'I want to book an appointment'
    });
    expect(out.mode).toBe('tenant_inbound_admin');
    expect(out.subrail).toBe('booking');
  });

  test('V5 symptom routes to clinical OPQRST', () => {
    const out = resolveConversationMode({
      call_type: 'inbound_tenant',
      direction: 'inbound',
      tenantPolicy: { triage_policy: 'required' },
      firstUtterance: 'I have a rash on my leg'
    });
    expect(out.mode).toBe('tenant_inbound_clinical');
    expect(out.subrail).toBe('opqrst');
  });

  test('V6 admin billing pivot same turn', () => {
    const out = evaluateTurn({
      utterance: 'I want to pay my copay',
      tenantPolicy: { billing_enabled: true },
      sessionState: { conversation_mode: 'tenant_inbound_admin', pending_intent_queue: [] }
    });
    expect(out.mode).toBe('tenant_billing');
    expect(out.subrail).toBe('copay_link');
  });

  test('V7 multi-intent billing primary keeps reschedule pending', () => {
    const out = evaluateTurn({
      utterance: 'pay copay and reschedule',
      tenantPolicy: { billing_enabled: true },
      sessionState: { conversation_mode: 'tenant_inbound_admin', pending_intent_queue: [] }
    });
    expect(out.mode).toBe('tenant_billing');
    expect(out.pending_intents).toContain('reschedule');
  });

  test('V8 cancellation subrail without retriage', async () => {
    const out = await handleCancellationSubrail({
      active_subrail_step: 'find_booking',
      message: 'cancel my appointment',
      current_booking_slot: { slot_id: 'x' }
    });
    expect(out.active_subrail).toBe('cancellation');
    expect(out.state_updates.opqrst_frozen).toBe(true);
  });

  test('V9 reschedule instead sets reschedule_pending on cancellation subrail', async () => {
    const out = await handleCancellationSubrail({
      active_subrail_step: 'confirm_cancel',
      message: 'reschedule instead'
    });
    expect(out.active_subrail).toBe('cancellation');
    expect(out.state_updates.reschedule_pending).toBe(true);
  });

  test('V10 OPQRST inconclusive exits safely', async () => {
    const out = await handleOpqrstSubrail({
      opqrst_accumulator: { O: 'today' },
      message: 'a bit',
      tenantPolicy: { inconclusive_triage_action: 'book_general' }
    });
    expect(['triage_inconclusive', undefined]).toContain(out.disposition);
  });

  test("V10b vague symptom routes to clinical OPQRST", () => {
    const out = resolveConversationMode({
      call_type: 'inbound_tenant',
      direction: 'inbound',
      tenantPolicy: { triage_policy: 'required', billing_enabled: true, records_enabled: true },
      firstUtterance: "I don't feel well"
    });
    expect(out.mode).toBe('tenant_inbound_clinical');
    expect(out.subrail).toBe('opqrst');
  });

  test('V11 OPQRST mid-flow billing pivot preserves accumulator', () => {
    const session = {
      conversation_mode: 'tenant_inbound_clinical',
      active_subrail: 'opqrst',
      opqrst_accumulator: { O: 'yesterday', P: 'worse with heat' },
      pending_intent_queue: []
    };
    const pivot = evaluateTurn({
      utterance: 'pay my copay',
      tenantPolicy: { billing_enabled: true },
      sessionState: session
    });
    expect(pivot.mode).toBe('tenant_billing');
    expect(pivot.subrail).toBe('copay_link');
    expect(pivot.pivot_event).toBe('billing_intent_detected');

    const next = applyPivotToSession(session, pivot);
    expect(next.opqrst_accumulator).toEqual({ O: 'yesterday', P: 'worse with heat' });
    expect(next.conversation_mode).toBe('tenant_billing');
    expect(next.prior_conversation_mode).toBe('tenant_inbound_clinical');
  });

  test('V11b OPQRST mode tool allowed only clinical+opqrst', () => {
    expect(
      isToolAllowedForMode('store_triage_opqrst', {
        mode: 'tenant_inbound_clinical',
        subrail: 'opqrst'
      })
    ).toBe(true);
    expect(
      isToolAllowedForMode('store_triage_opqrst', {
        mode: 'tenant_billing',
        subrail: 'copay_link'
      })
    ).toBe(false);
  });

  test('V12 emergency phrase pivots to emergency mode', () => {
    const out = evaluateTurn({
      utterance: 'I have chest pain',
      tenantPolicy: {},
      sessionState: { conversation_mode: 'tenant_inbound_clinical' }
    });
    expect(out.mode).toBe('emergency_safety');
    expect(isToolAllowedForMode('request_patient_payment', { mode: out.mode })).toBe(false);
  });

  test('V13 records intent pivots to records mode', () => {
    const out = evaluateTurn({
      utterance: 'I need my medical records',
      tenantPolicy: { records_enabled: true },
      sessionState: { conversation_mode: 'tenant_inbound_admin' }
    });
    expect(out.mode).toBe('tenant_records');
    expect(out.subrail).toBe('records_qa');
  });

  test('V14 missing call_type fail-closed tenant unresolved', () => {
    const out = resolveConversationMode({
      call_type: null,
      direction: 'inbound',
      tenantPolicy: {},
      tenantResolved: false
    });
    expect(out.fail_closed).toBe(true);
    expect(out.subrail).toBe('handoff');
  });
});

