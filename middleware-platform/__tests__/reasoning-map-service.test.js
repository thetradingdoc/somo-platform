'use strict';

const { buildReasoningMap, validateReasoningMap } = require('../services/reasoning-map-service');

describe('reasoning-map-service', () => {
  test('builds valid map and blocks unsafe combo', () => {
    const map = buildReasoningMap({
      historyText: 'My skin is sunburned and I used glycolic acid and retinoid',
      primaryConcern: 'barrier_dryness_sensitivity',
      concerns: ['barrier_dryness_sensitivity'],
      triggers: ['retinoid'],
      bodyAreas: ['face'],
      intentPrimary: 'treat',
      intentSecondary: [],
      routineConflicts: [],
      productTaxonomy: null,
      baseConfidence: 0.8
    });
    const valid = validateReasoningMap(map);
    expect(valid.ok).toBe(true);
    expect(map.safety_flags.blocked).toBe(true);
    expect(Array.isArray(map.rules_fired)).toBe(true);
  });
});

