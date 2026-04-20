'use strict';

const { buildScanSummary, buildResultSummary } = require('../services/product-summary-service');

describe('result summary contract guards', () => {
  test('children_safe.answer stays within frontend-supported enum set', () => {
    const allowed = new Set(['safe', 'caution', 'insufficient_data']);
    const cases = [
      { categoryRoute: 'food', ingredients_text: 'water, sugar, red 40', expected: 'caution' },
      { categoryRoute: 'food', ingredients_text: 'water, sugar', expected: 'safe' },
      { categoryRoute: 'supplement', ingredients_text: 'vitamin c, yellow 6', expected: 'caution' },
      { categoryRoute: 'cosmetic', ingredients_text: 'water, glycerin', expected: 'insufficient_data' }
    ];
    for (const c of cases) {
      const result = buildResultSummary({
        scanSummary: buildScanSummary({ product: { ingredients_text: c.ingredients_text }, categoryRoute: c.categoryRoute }),
        product: { ingredients_text: c.ingredients_text },
        hasProfileContext: false,
        routineConflicts: [],
        categoryRoute: c.categoryRoute,
        reasoningEnabled: false
      });
      const answer = String(result?.verdict?.children_safe?.answer || '');
      expect(allowed.has(answer)).toBe(true);
      expect(answer).toBe(c.expected);
    }
  });

  test('food route tile reason_unavailable codes remain contract-stable', () => {
    const scan = buildScanSummary({
      product: { ingredients_text: 'water, sugar, citric acid' },
      categoryRoute: 'food'
    });
    expect(scan.tiles.key_actives.reason_unavailable).toBe('not_applicable_cosmetic_actives');
    expect(scan.tiles.function.reason_unavailable).toBe('not_applicable_cosmetic_function');
    expect(scan.tiles.skin_type.reason_unavailable).toBe('not_applicable_skin_type_for_food');
  });
});

