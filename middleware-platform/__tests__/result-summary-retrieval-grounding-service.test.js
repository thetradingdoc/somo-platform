const svc = require('../services/result-summary-retrieval-grounding-service');

describe('result-summary-retrieval-grounding-service', () => {
  test('extracts route-aware keywords for cosmetic without nutrition leakage', () => {
    const out = svc.extractRouteAwareKeywords({
      categoryRoute: 'cosmetic',
      ingredientsText: 'Water, Niacinamide, Vitamin C',
      productName: 'Glow Serum'
    });
    expect(out.join(' ')).toMatch(/niacinamide/i);
    expect(out.join(' ')).not.toMatch(/calories/i);
  });

  test('builds route-specific retrieval plan by route', () => {
    const cosmetic = svc.buildRouteSpecificRetrievalPlan({ categoryRoute: 'cosmetic' });
    const food = svc.buildRouteSpecificRetrievalPlan({ categoryRoute: 'food' });
    expect(cosmetic.sources_by_field['verdict.alternatives.candidates']).toContain('catalog_similarity_index');
    expect(food.sources_by_field['verdict.alternatives.candidates']).toContain('route_policy_block');
  });

  test('builds claim provenance with required shape', () => {
    const plan = svc.buildRouteSpecificRetrievalPlan({ categoryRoute: 'food' });
    const prov = svc.buildClaimProvenance({
      fieldPath: 'verdict.harmful.flags',
      plan,
      keywords: ['phenoxyethanol']
    });
    expect(Array.isArray(prov)).toBe(true);
    expect(prov[0]).toHaveProperty('source');
    expect(prov[0]).toHaveProperty('doc_id_ref');
    expect(prov[0]).toHaveProperty('evidence_snippet_key');
  });
});
