const {
  buildSemanticContract,
  buildScanSummary,
  buildResultSummary,
  applyReasoningPatch,
  sanitizeReasoningText
} = require('../services/product-summary-service');

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
    expect(out.tiles.skin_type.reason_unavailable).toBe('not_applicable_skin_type_for_food');
    expect(out.tiles.formulation.status).toBe('available');
    expect(String(out.tiles.formulation.value)).toMatch(/liquid/i);
  });

  test('non-cosmetic route does not emit cosmetic actives/function tags even when ingredient text contains cosmetic keywords', () => {
    const out = buildScanSummary({
      product: { ingredients_text: 'Water, Vitamin C, Niacinamide, Sugar' },
      categoryRoute: 'food',
      catalogSource: 'open_food_facts'
    });
    expect(out.tiles.key_actives.status).toBe('unavailable');
    expect(out.tiles.key_actives.reason_unavailable).toBe('not_applicable_cosmetic_actives');
    expect(out.tiles.function.status).toBe('unavailable');
    expect(out.tiles.function.reason_unavailable).toBe('not_applicable_cosmetic_function');
  });

  test('non-cosmetic result summary side effects stays route-safe even with acid ingredients', () => {
    const result = buildResultSummary({
      scanSummary: buildScanSummary({
        product: { ingredients_text: 'water, sugar, lactic acid, vitamin c' },
        categoryRoute: 'food'
      }),
      product: { ingredients_text: 'water, sugar, lactic acid, vitamin c' },
      hasProfileContext: true,
      routineConflicts: [],
      categoryRoute: 'food',
      reasoningEnabled: false
    });
    expect(result.verdict.side_effects.summary).toBe('Not assessed in this scan.');
  });

  test('food route uses route-aware missing_more copy', () => {
    const result = buildResultSummary({
      scanSummary: buildScanSummary({
        product: { ingredients_text: 'water, sugar, red 40' },
        categoryRoute: 'food'
      }),
      product: { ingredients_text: 'water, sugar, red 40' },
      hasProfileContext: false,
      routineConflicts: [],
      categoryRoute: 'food',
      reasoningEnabled: false
    });
    expect(result.missing_more.join(' ')).toMatch(/food|supplement|additive|dye|alternatives/i);
    expect(result.missing_more.join(' ')).not.toMatch(/pediatric profile/i);
  });

  test('builds semantic contract by route', () => {
    const cosmetic = buildSemanticContract('cosmetic');
    const food = buildSemanticContract('food');
    expect(cosmetic.verdict_framing).toBe('cosmetic');
    expect(cosmetic.valid_fields).toContain('tiles.key_actives');
    expect(cosmetic.valid_fields).toContain('verdict.alternatives');
    expect(food.verdict_framing).toBe('catalog_context');
    expect(food.valid_fields).toContain('verdict.alternatives.footer');
    expect(food.valid_fields).not.toContain('verdict.alternatives');
    expect(food.forbidden_vocab).toContain('tone_evening');
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
      scanSummary: buildScanSummary({ product: { ingredients_text: 'Water, Niacinamide, Phenoxyethanol' }, categoryRoute: 'cosmetic' }),
      product: { ingredients_text: 'Water, Niacinamide, Phenoxyethanol' },
      hasProfileContext: true,
      routineConflicts: [{ id: 'c1', severity: 'high', summary: 'Conflict detected' }],
      categoryRoute: 'cosmetic'
    });
    expect(result.disclaimer).toBe('informational_only');
    expect(result.verdict.good_for_me.status).toBe('available');
    expect(result.verdict.good_for_me.summary).toMatch(/routine|session context/i);
    expect(result.verdict.harmful.severity).toBe('high');
    expect(Array.isArray(result.verdict.harmful.flags)).toBe(true);
    expect(result.verdict.harmful.flags.join(' ')).toMatch(/phenoxyethanol|conflict/i);
    expect(result.verdict.harmful.top_evidence).toMatch(/conflict/i);
    expect(result.verdict.children_safe.answer).toBe('caution');
    expect(result.verdict.children_safe.pending).toBe(false);
    expect(result.verdict.side_effects.summary).toMatch(/niacinamide|irritation/i);
    expect(result.verdict.alternatives.status).toBe('available');
    expect(result.verdict.alternatives.count).toBeGreaterThan(0);
    expect(result.verdict.alternatives.footer).toMatch(/Kelly|routine/i);
    expect(Array.isArray(result.missing_more)).toBe(true);
    expect(result.semantic_contract.route).toBe('cosmetic');
  });

  test('marks reasoning-backed verdict fields as pending when profile context is absent', () => {
    const result = buildResultSummary({
      scanSummary: buildScanSummary({ product: { ingredients_text: 'Water, Glycerin' }, categoryRoute: 'cosmetic' }),
      product: { ingredients_text: 'Water, Glycerin' },
      hasProfileContext: false,
      routineConflicts: [],
      categoryRoute: 'cosmetic'
    });
    expect(result.verdict.good_for_me.status).toBe('deferred');
    expect(result.verdict.good_for_me.pending).toBe(true);
    expect(result.verdict.good_for_me.detail).toMatch(/Deeper analysis running/i);
    expect(result.verdict.children_safe.pending).toBe(true);
  });

  test('keeps deterministic mode when reasoning feature is disabled', () => {
    const result = buildResultSummary({
      scanSummary: buildScanSummary({ product: { ingredients_text: 'Water, Glycerin' }, categoryRoute: 'cosmetic' }),
      product: { ingredients_text: 'Water, Glycerin' },
      hasProfileContext: false,
      routineConflicts: [],
      categoryRoute: 'cosmetic',
      reasoningEnabled: false
    });
    expect(result.reasoning.enabled).toBe(false);
    expect(result.reasoning.status).toBe('disabled');
    expect(Array.isArray(result.reasoning.allowed_upgrade_fields)).toBe(true);
  });

  test('applies reasoning only to permitted fields with confidence gate', () => {
    const base = buildResultSummary({
      scanSummary: buildScanSummary({ product: { ingredients_text: 'Water, Niacinamide' }, categoryRoute: 'cosmetic' }),
      product: { ingredients_text: 'Water, Niacinamide' },
      hasProfileContext: true,
      routineConflicts: [],
      categoryRoute: 'cosmetic',
      reasoningEnabled: false
    });
    const out = applyReasoningPatch(base, {
      reasoning_model: 'test-model',
      reasoning_version: 'v1',
      reasoning_evidence_refs: ['pinecone:ingredient:niacinamide'],
      verdict: {
        good_for_me: {
          summary: 'This can diagnose acne quickly.',
          summary_confidence: 0.9
        },
        product_overview: {
          what_it_does: 'Should not overwrite deterministic field.'
        }
      }
    }, { enabled: true });
    expect(out.verdict.good_for_me.source).toBe('reasoning');
    expect(out.verdict.good_for_me.summary).toMatch(/assess acne/i);
    expect(out.verdict.product_overview.what_it_does).not.toMatch(/overwrite/i);
    expect(out.reasoning.reasoning_model).toBe('test-model');
    expect(out.reasoning.status).toBe('applied');
  });

  test('marks reasoning-owned field deferred when confidence is too low', () => {
    const base = buildResultSummary({
      scanSummary: buildScanSummary({ product: { ingredients_text: 'Water, Niacinamide' }, categoryRoute: 'cosmetic' }),
      product: { ingredients_text: 'Water, Niacinamide' },
      hasProfileContext: true,
      routineConflicts: [],
      categoryRoute: 'cosmetic',
      reasoningEnabled: false
    });
    const out = applyReasoningPatch(base, {
      verdict: {
        harmful: {
          top_evidence: 'Low-confidence speculative claim.',
          top_evidence_confidence: 0.2
        }
      }
    }, { enabled: true });
    expect(out.verdict.harmful.reason_unavailable).toBe('reasoning_low_confidence');
    expect(out.reasoning.status).toBe('deferred');
  });

  test('enforces confidence gates across verdict field families', () => {
    const base = buildResultSummary({
      scanSummary: buildScanSummary({ product: { ingredients_text: 'Water, Niacinamide' }, categoryRoute: 'cosmetic' }),
      product: { ingredients_text: 'Water, Niacinamide' },
      hasProfileContext: true,
      routineConflicts: [],
      categoryRoute: 'cosmetic',
      reasoningEnabled: false
    });
    const out = applyReasoningPatch(base, {
      verdict: {
        good_for_me: {
          summary: 'low confidence summary',
          summary_confidence: 0.1,
          detail: 'low confidence detail',
          detail_confidence: 0.1
        },
        harmful: {
          flags: ['speculative flag'],
          flags_confidence: 0.1,
          summary: 'speculative harmful summary',
          summary_confidence: 0.1
        },
        children_safe: {
          summary: 'speculative children guidance',
          summary_confidence: 0.1
        },
        side_effects: {
          summary: 'speculative side effects',
          summary_confidence: 0.1
        },
        alternatives: {
          candidates: ['speculative alternative'],
          candidates_confidence: 0.1
        }
      }
    }, { enabled: true });
    expect(out.verdict.good_for_me.reason_unavailable).toBe('reasoning_low_confidence');
    expect(out.verdict.harmful.reason_unavailable).toBe('reasoning_low_confidence');
    expect(out.verdict.children_safe.reason_unavailable).toBe('reasoning_low_confidence');
    expect(out.verdict.side_effects.reason_unavailable).toBe('reasoning_low_confidence');
    expect(out.verdict.alternatives.reason_unavailable).toBe('reasoning_low_confidence');
    expect(out.reasoning.status).toBe('deferred');
  });

  test('rejects route-invalid reasoning field updates with unsupported_for_route and keeps deterministic baseline', () => {
    const base = buildResultSummary({
      scanSummary: buildScanSummary({ product: { ingredients_text: 'water, sugar, niacinamide' }, categoryRoute: 'food' }),
      product: { ingredients_text: 'water, sugar, niacinamide' },
      hasProfileContext: true,
      routineConflicts: [],
      categoryRoute: 'food',
      reasoningEnabled: false
    });
    const before = base.verdict.good_for_me.summary;
    const out = applyReasoningPatch(base, {
      reasoning_model: 'test-model',
      reasoning_version: 'v1',
      verdict: {
        good_for_me: {
          summary: 'Targets tone_evening and anti_aging for this item.',
          summary_confidence: 0.95
        }
      }
    }, { enabled: true });
    expect(out.verdict.good_for_me.status).toBe('unsupported_for_route');
    expect(out.verdict.good_for_me.reason_unavailable).toBe('unsupported_for_route');
    expect(out.verdict.good_for_me.summary).toBe(before);
  });

  test('applies reasoning alternatives on cosmetic route when confidence and evidence pass', () => {
    const base = buildResultSummary({
      scanSummary: buildScanSummary({ product: { ingredients_text: 'water, butylene glycol' }, categoryRoute: 'cosmetic' }),
      product: { ingredients_text: 'water, butylene glycol' },
      hasProfileContext: true,
      routineConflicts: [],
      categoryRoute: 'cosmetic',
      reasoningEnabled: false
    });
    const out = applyReasoningPatch(base, {
      reasoning_model: 'test-model',
      reasoning_version: 'v1',
      reasoning_claim_provenance: {
        'verdict.alternatives.candidates': [
          { source: 'model_reasoning:direct', doc_id_ref: 'model:1', evidence_snippet_key: 'alternatives' }
        ]
      },
      verdict: {
        alternatives: {
          candidates: ['Fragrance-free ceramide moisturizer'],
          candidates_confidence: 0.9
        }
      }
    }, { enabled: true });
    expect(out.verdict.alternatives.source).toBe('reasoning');
    expect(out.verdict.alternatives.status).toBe('available');
    expect(out.verdict.alternatives.candidates).toContain('Fragrance-free ceramide moisturizer');
  });

  test('defers reasoning alternatives on cosmetic route when evidence is missing', () => {
    const base = buildResultSummary({
      scanSummary: buildScanSummary({ product: { ingredients_text: 'water, butylene glycol' }, categoryRoute: 'cosmetic' }),
      product: { ingredients_text: 'water, butylene glycol' },
      hasProfileContext: true,
      routineConflicts: [],
      categoryRoute: 'cosmetic',
      reasoningEnabled: false
    });
    const out = applyReasoningPatch(base, {
      reasoning_model: 'test-model',
      reasoning_version: 'v1',
      verdict: {
        alternatives: {
          candidates: ['Fragrance-free ceramide moisturizer'],
          candidates_confidence: 0.9
        }
      }
    }, { enabled: true });
    expect(out.verdict.alternatives.reason_unavailable).toBe('reasoning_insufficient_evidence');
    expect(out.verdict.alternatives.source).not.toBe('reasoning');
  });

  test('rejects reasoning alternatives on food route even when confidence and evidence are present', () => {
    const base = buildResultSummary({
      scanSummary: buildScanSummary({ product: { ingredients_text: 'water, sugar' }, categoryRoute: 'food' }),
      product: { ingredients_text: 'water, sugar' },
      hasProfileContext: true,
      routineConflicts: [],
      categoryRoute: 'food',
      reasoningEnabled: false
    });
    const out = applyReasoningPatch(base, {
      reasoning_model: 'test-model',
      reasoning_version: 'v1',
      reasoning_claim_provenance: {
        'verdict.alternatives.candidates': [
          { source: 'model_reasoning:direct', doc_id_ref: 'model:1', evidence_snippet_key: 'alternatives' }
        ]
      },
      verdict: {
        alternatives: {
          candidates: ['Snack replacement'],
          candidates_confidence: 0.95
        }
      }
    }, { enabled: true });
    expect(out.verdict.alternatives.status).toBe('unsupported_for_route');
    expect(out.verdict.alternatives.reason_unavailable).toBe('unsupported_for_route');
  });

  test('ignores reasoning patch built against stale semantic contract version', () => {
    const base = buildResultSummary({
      scanSummary: buildScanSummary({ product: { ingredients_text: 'Water, Niacinamide' }, categoryRoute: 'cosmetic' }),
      product: { ingredients_text: 'Water, Niacinamide' },
      hasProfileContext: true,
      routineConflicts: [],
      categoryRoute: 'cosmetic',
      reasoningEnabled: false
    });
    const before = base.verdict.good_for_me.summary;
    const out = applyReasoningPatch(base, {
      semantic_contract_version: '0',
      verdict: {
        good_for_me: {
          summary: 'Would overwrite if version matched.',
          summary_confidence: 0.95
        }
      }
    }, { enabled: true });
    expect(out.verdict.good_for_me.summary).toBe(before);
    expect(out.verdict.good_for_me.source).not.toBe('reasoning');
  });

  test('sanitizes unsafe diagnosis-style reasoning copy', () => {
    expect(sanitizeReasoningText('This diagnoses and cures acne with guaranteed results.')).toBe(
      'This assess and support acne with suggest results.'
    );
  });
});
