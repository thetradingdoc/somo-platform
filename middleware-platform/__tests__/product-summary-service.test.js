const { buildScanSummary, buildResultSummary } = require('../services/product-summary-service');

describe('product-summary-service', () => {
  test('builds available deterministic tiles when ingredients are present', () => {
    const out = buildScanSummary({
      product: { ingredients_text: 'Water, Niacinamide 10%, Zinc PCA 1%' },
      categoryRoute: 'cosmetic',
      categoryRouteSource: 'taxonomy_map',
      categoryRouteRuleId: 'tag:en:cosmetics',
      catalogSource: 'open_beauty_facts'
    });
    expect(out.tiles.key_actives.status).toBe('available');
    expect(out.tiles.formulation.status).toBe('available');
    expect(out.tiles.skin_type.status).toBe('deferred');
    expect(out.tiles.safety_score.reason_unavailable).toBe('no_scoring_pipeline');
  });

  test('food product with ingredients but no cosmetic actives uses not_applicable reasons, not missing_ingredients', () => {
    const out = buildScanSummary({
      product: { ingredients_text: 'water, sugar, citric acid, natural flavor' },
      categoryRoute: 'food',
      catalogSource: 'open_food_facts'
    });
    expect(out.tiles.key_actives.reason_unavailable).toBe('not_applicable_cosmetic_actives');
    expect(out.tiles.function.reason_unavailable).toBe('not_applicable_cosmetic_function');
    expect(out.tiles.formulation.status).toBe('available');
    expect(String(out.tiles.formulation.value)).toMatch(/liquid/i);
  });

  test('returns unavailable tiles when ingredients missing', () => {
    const out = buildScanSummary({
      product: { ingredients_text: '' },
      categoryRoute: 'unknown'
    });
    expect(out.tiles.key_actives.status).toBe('unavailable');
    expect(out.tiles.key_actives.reason_unavailable).toBe('missing_ingredients');
  });

  test('builds result summary with disclaimer and verdict', () => {
    const result = buildResultSummary({
      scanSummary: buildScanSummary({ product: { ingredients_text: 'Water, Niacinamide' }, categoryRoute: 'cosmetic' }),
      hasProfileContext: true,
      routineConflicts: [{ id: 'c1', severity: 'high', summary: 'Conflict detected' }],
      categoryRoute: 'cosmetic'
    });
    expect(result.disclaimer).toBe('informational_only');
    expect(result.verdict.good_for_me.status).toBe('available');
    expect(result.verdict.harmful.severity).toBe('high');
    expect(result.verdict.children_safe.answer).toBe('caution');
    expect(result.verdict.side_effects.summary).toBe('Not assessed in this scan.');
    expect(result.verdict.alternatives.status).toBe('available');
    expect(Array.isArray(result.missing_more)).toBe(true);
  });
});
