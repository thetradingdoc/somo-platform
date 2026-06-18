'use strict';

process.env.CONVERSATION_MODE_ROUTING = 'enforce';

const { KELLY_LANE } = require('../services/kelly-rails/state-schema');
const {
  applyLaneStepFromL2Handoff,
  shouldSkipLegacyRouting
} = require('../services/kelly-rails/lane-handoff-mapper');

describe('lane-handoff-mapper', () => {
  test('shouldSkipLegacyRouting when enforce + conversation_mode set', () => {
    expect(shouldSkipLegacyRouting({ conversation_mode: 'tenant_inbound_admin' }, true)).toBe(true);
    expect(shouldSkipLegacyRouting({ conversation_mode: 'tenant_inbound_admin' }, false)).toBe(false);
    expect(shouldSkipLegacyRouting({}, true)).toBe(false);
  });

  test('maps booking subrail to BOOKING lane without legacy reroute under enforce', () => {
    const state = {
      conversation_mode: 'tenant_inbound_admin',
      active_subrail: 'booking',
      active_subrail_step: 'slot_lookup',
      active_lane: KELLY_LANE.CLINICAL,
      step: 'triage_assessment',
      flags: { active_subrail: 'booking', booking_intents: ['schedule'] }
    };
    const ctx = { sessionId: 'sess-map', message: 'book tomorrow at noon' };

    const out = applyLaneStepFromL2Handoff(state, ctx, {}, { enforceMode: true });

    expect(out.skipLegacyRouting).toBe(true);
    expect(state.active_lane).toBe(KELLY_LANE.BOOKING);
    expect(state.step).toBe('schedule_visit');
  });

  test('maps records_qa subrail to RECORDS lane', () => {
    const state = {
      conversation_mode: 'tenant_records',
      active_subrail: 'records_qa',
      active_subrail_step: 'records_qa',
      active_lane: KELLY_LANE.ROUTER,
      step: 'await_intent',
      flags: {}
    };
    const ctx = { sessionId: 'sess-rec', message: 'What were my lab results?' };

    const out = applyLaneStepFromL2Handoff(state, ctx, { kelly_lane_hint: 'records' }, { enforceMode: true });

    expect(state.active_lane).toBe(KELLY_LANE.RECORDS);
    expect(state.step).toBe('records_qa');
    expect(state.flags.conversation_mode).toBe('tenant_records');
    expect(out.onRecordsRail).toBe(true);
  });
});
