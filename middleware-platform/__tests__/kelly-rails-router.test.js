'use strict';

const path = require('path');
const { KELLY_LANE, routeOrchestratorLane } = require('../services/kelly-rails/state-schema');

const fixture = require('../tests/fixtures/kelly-rails-golden-utterances.json');

describe('kelly-rails routeOrchestratorLane golden utterances', () => {
  for (const row of fixture.cases) {
    test(`${row.id} (${row.bucket})`, () => {
      const r = routeOrchestratorLane({
        last_user_message: row.last_user_message,
        flags: row.flags || {}
      });
      expect(r.lane).toBe(row.expect.lane);
      expect(r.step).toBe(row.expect.step);
      if (row.expect.safety_blocked) {
        expect(r.safety_blocked).toBe(true);
      }
    });
  }
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

describe('kelly-rails routeOrchestratorLane legacy spot checks', () => {
  test('pay copay routes to payment lane', () => {
    const r = routeOrchestratorLane({
      last_user_message: 'I want to pay my copay now with a secure payment link',
      flags: {}
    });
    expect(r.lane).toBe(KELLY_LANE.PAYMENT);
  });
});
