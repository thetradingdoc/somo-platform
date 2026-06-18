'use strict';

jest.mock('../database', () => ({
  getTriageSession: jest.fn(() => null),
  db: null,
  insertKellyCallEvent: jest.fn()
}));

jest.mock('../services/kelly-tool-executor', () => {
  const meta = {};
  return {
    execute: jest.fn(async () => ({ success: true })),
    _getSessionMeta: jest.fn((sid, key) => meta[`${sid}:${key}`] || null),
    _setSessionMeta: jest.fn((sid, key, val) => {
      meta[`${sid}:${key}`] = val;
    }),
    KELLY_TOOLS: []
  };
});

jest.mock('../services/kelly-rails/node-runner', () => ({
  runNodeStep: jest.fn(async () => ({ reply: 'llm', toolsUsed: [], endCall: false }))
}));

const { executeTurn } = require('../services/kelly-rails/execute-turn');
const { KELLY_LANE } = require('../services/kelly-rails/state-schema');

describe('kelly-rails executeTurn education escape', () => {
  test('education lane reroutes to clinical on dermatology escape utterance', async () => {
    const { state, reply } = await executeTurn({
      sessionId: 'sess-escape',
      message: 'I have an itchy rash and need a dermatology appointment',
      active_lane: KELLY_LANE.EDUCATION,
      step: 'education',
      flags: { routine_intake_active: true },
      v2_hydrated: true
    });

    expect([KELLY_LANE.CLINICAL, KELLY_LANE.BOOKING]).toContain(state.active_lane);
    expect(reply).toBeTruthy();
  });
});

describe('kelly-rails executeTurn post_payment confirmation', () => {
  test('routes to post_payment and returns confirmation copy', async () => {
    const KellyToolExecutor = require('../services/kelly-tool-executor');
    KellyToolExecutor._setSessionMeta('sess-pp', 'last_appointment_id', 'appt-1');
    KellyToolExecutor._setSessionMeta('sess-pp', 'last_slot_date', '2026-06-10');
    KellyToolExecutor._setSessionMeta('sess-pp', 'last_slot_time', '12:00');

    const { state, reply } = await executeTurn({
      sessionId: 'sess-pp',
      message: 'What happens next?',
      flags: {
        appointment_id: 'appt-1',
        post_visit_confirmation_pending: true
      },
      v2_hydrated: true
    });

    expect(state.active_lane).toBe(KELLY_LANE.POST_PAYMENT);
    expect(reply).toMatch(/confirmed|appointment/i);
  });
});

describe('kelly-rails executeTurn pay-before-book', () => {
  test('redirects to booking when payment gate closed but triage ready', async () => {
    const { state } = await executeTurn({
      sessionId: 'sess-pay-before-book',
      message: 'I want to pay my copay now please send a secure payment link',
      flags: {
        copay_amount: 25,
        appointment_id: null,
        has_rag: true,
        triage_complete: true
      },
      v2_hydrated: true
    });

    expect(state.active_lane).toBe(KELLY_LANE.BOOKING);
  });
});

describe('kelly-rails executeTurn enforce drain', () => {
  const prevRouting = process.env.CONVERSATION_MODE_ROUTING;

  beforeAll(() => {
    process.env.CONVERSATION_MODE_ROUTING = 'enforce';
    process.env.KELLY_RAILS_V2 = '1';
  });

  afterAll(() => {
    process.env.CONVERSATION_MODE_ROUTING = prevRouting;
  });

  test('under enforce, booking subrail is not rerouted by keyword sniffing', async () => {
    const { state } = await executeTurn({
      sessionId: 'sess-enforce-drain',
      message: 'I want to book an appointment tomorrow at noon',
      conversation_mode: 'tenant_inbound_admin',
      active_subrail: 'booking',
      active_subrail_step: 'slot_lookup',
      active_lane: KELLY_LANE.BOOKING,
      step: 'schedule_visit',
      flags: {
        conversation_mode: 'tenant_inbound_admin',
        active_subrail: 'booking',
        booking_intents: ['schedule']
      },
      v2_hydrated: true
    });

    expect(state.active_lane).toBe(KELLY_LANE.BOOKING);
    expect(state.step).toBe('schedule_visit');
  });
});

describe('kelly-rails executeTurn safety', () => {
  test('chest pain triggers emergency handoff reply', async () => {
    const { state, reply, endCall } = await executeTurn({
      sessionId: 'sess-em',
      message: "I'm having chest pain",
      v2_hydrated: true
    });

    expect(state.flags.safety_blocked).toBe(true);
    expect(reply).toMatch(/911|emergency/i);
    expect(endCall).toBe(true);
  });
});
