'use strict';

const { KELLY_LANE, routeOrchestratorLane } = require('../services/kelly-rails/state-schema');

describe('kelly-rails routeOrchestratorLane', () => {
  test('rash routes to clinical lane', () => {
    const r = routeOrchestratorLane({
      last_user_message: 'I have an itchy rash on my arm. I need dermatology.',
      flags: { routine_intake_active: false }
    });
    expect(r.lane).toBe(KELLY_LANE.CLINICAL);
  });

  test('pay copay routes to payment lane', () => {
    const r = routeOrchestratorLane({
      last_user_message: 'I want to pay my copay now with a secure payment link',
      flags: {}
    });
    expect(r.lane).toBe(KELLY_LANE.PAYMENT);
  });

  test('receipt routes to support', () => {
    const r = routeOrchestratorLane({
      last_user_message: 'I need a receipt for my last appointment',
      flags: {}
    });
    expect(r.lane).toBe(KELLY_LANE.SUPPORT);
  });

  test('reschedule routes to reschedule lane', () => {
    const r = routeOrchestratorLane({
      last_user_message: 'I need to reschedule my appointment please',
      flags: {}
    });
    expect(r.lane).toBe(KELLY_LANE.RESCHEDULE);
  });
});

describe('kelly-rails config', () => {
  const orig = process.env.KELLY_RAILS_V2;
  afterEach(() => {
    if (orig === undefined) delete process.env.KELLY_RAILS_V2;
    else process.env.KELLY_RAILS_V2 = orig;
  });

  test('shouldUseKellyRailsV2 when env set', () => {
    process.env.KELLY_RAILS_V2 = '1';
    const { shouldUseKellyRailsV2 } = require('../services/kelly-rails/config');
    expect(shouldUseKellyRailsV2('sess-1')).toBe(true);
  });
});
