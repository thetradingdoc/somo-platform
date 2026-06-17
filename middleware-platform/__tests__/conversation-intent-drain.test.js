'use strict';

const {
  drainPendingIntentsForAppointment,
  mergeKellyRailsIntoSession
} = require('../services/conversation-mode/conversation-mode-session');
const { UserIntent } = require('../services/conversation-mode/conversation-mode-types');

describe('intent drain unify', () => {
  test('drains BOOK after cancel_complete without second book utterance', () => {
    const session = {
      pending_intent_queue: [UserIntent.BOOK],
      conversation_mode: 'tenant_inbound_admin',
      active_subrail: 'cancellation'
    };
    const out = drainPendingIntentsForAppointment(session, { cancel_complete: true });
    expect(out.pending_intent_queue).toEqual([]);
    expect(out.completed_intents).toContain(UserIntent.BOOK);
    expect(out.rebook_after_cancel).toBe(true);
    expect(out.active_subrail).toBe('booking');
    expect(out.kelly_lane_hint).toBe('booking');
  });

  test('drains PAY_COPAY after schedule_appointment_success', () => {
    const session = {
      pending_intent_queue: [UserIntent.PAY_COPAY],
      conversation_mode: 'tenant_inbound_admin'
    };
    const out = drainPendingIntentsForAppointment(session, { schedule_appointment_success: true });
    expect(out.active_subrail).toBe('copay_link');
    expect(out.conversation_mode).toBe('tenant_billing');
  });

  test('mergeKellyRails only sets schedule success when flag present', () => {
    const merged = mergeKellyRailsIntoSession(
      { pending_intent_queue: [UserIntent.PAY_COPAY] },
      { flags: { schedule_appointment_success: true }, active_lane: 'booking' },
      ['schedule_appointment']
    );
    expect(merged.schedule_appointment_success).toBe(true);
    const noFlag = mergeKellyRailsIntoSession({}, { flags: {}, active_lane: 'booking' }, [
      'schedule_appointment'
    ]);
    expect(noFlag.schedule_appointment_success).toBeUndefined();
  });

  test('records_complete triggers drain for follow-on intent', () => {
    const session = {
      pending_intent_queue: [UserIntent.BOOK],
      conversation_mode: 'tenant_records'
    };
    const out = drainPendingIntentsForAppointment(session, { records_complete: true });
    expect(out.completed_intents).toContain(UserIntent.BOOK);
    expect(out.active_subrail).toBe('booking');
  });
});
