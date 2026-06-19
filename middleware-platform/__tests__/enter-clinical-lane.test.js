'use strict';

const { canEnterClinicalLane, guardClinicalRoute } = require('../services/kelly-rails/enter-clinical-lane');
const { KELLY_LANE } = require('../services/kelly-rails/state-schema');

describe('enter-clinical-lane (L-3)', () => {
  test('blocks clinical without symptom evidence', () => {
    expect(
      canEnterClinicalLane({ message: 'Can I make a booking?', triageRow: null })
    ).toBe(false);
  });

  test('guardClinicalRoute downgrades booking to BOOKING lane', () => {
    const route = guardClinicalRoute(
      { lane: KELLY_LANE.CLINICAL, step: 'clinical_intake' },
      { message: 'Can I make a booking?' }
    );
    expect(route.lane).toBe(KELLY_LANE.BOOKING);
  });

  test('allows clinical with symptom text', () => {
    const route = guardClinicalRoute(
      { lane: KELLY_LANE.CLINICAL, step: 'clinical_intake' },
      { message: 'I have a rash on my leg' }
    );
    expect(route.lane).toBe(KELLY_LANE.CLINICAL);
  });
});
