const {
  buildScanSummary,
  buildResultSummary,
  applyReasoningPatch,
  sanitizeReasoningText
} = require('../services/product-summary-service');
const ReasoningService = require('../services/result-summary-reasoning-service');
const { isAllowedLandingVoiceMetricName } = require('../services/landing-voice-metrics-contract');

function makeResult({
  categoryRoute = 'food',
  ingredientsText = 'water, sugar',
  reasoningEnabled = false,
  hasProfileContext = false,
  routineConflicts = [],
  product = {}
} = {}) {
  const p = {
    ingredients_text: ingredientsText,
    category_route: categoryRoute,
    ...product
  };
  const scanSummary = buildScanSummary({
    product: p,
    categoryRoute
  });
  return buildResultSummary({
    scanSummary,
    product: p,
    hasProfileContext,
    routineConflicts,
    categoryRoute,
    reasoningEnabled
  });
}

describe('reasoning-pipeline', () => {
  describe('Section A - route-gated watch flags and tile reasons', () => {
    test('A1: food route does not emit cosmetic watch flags', () => {
      const out = makeResult({
        categoryRoute: 'food',
        ingredientsText: 'water, sugar, niacinamide, fragrance'
      });
      const joined = (out?.verdict?.harmful?.flags || []).join(' ').toLowerCase();
      expect(joined).not.toMatch(/fragrance allergen|retinoid|exfoliant|phenoxyethanol/);
    });

    test('A2: cosmetic route emits fragrance watch flags when present', () => {
      const out = makeResult({
        categoryRoute: 'cosmetic',
        ingredientsText: 'water, parfum, niacinamide'
      });
      const joined = (out?.verdict?.harmful?.flags || []).join(' ').toLowerCase();
      expect(joined).toMatch(/fragrance/);
    });

    test('A3: food key_actives reason code is route-safe', () => {
      const out = makeResult({
        categoryRoute: 'food',
        ingredientsText: 'water, sugar, vitamin c'
      });
      expect(out.tiles.key_actives.reason_unavailable).toBe('not_applicable_cosmetic_actives');
    });

    test('A4: food skin_type reason_unavailable is not_applicable_skin_type_for_food', () => {
      const out = makeResult({
        categoryRoute: 'food',
        ingredientsText: 'water, sugar'
      });
      expect(out.tiles.skin_type.reason_unavailable).toBe('not_applicable_skin_type_for_food');
    });

    test('A5: supplement skin_type reason_unavailable is not_applicable_skin_type_for_food', () => {
      const out = makeResult({
        categoryRoute: 'supplement',
        ingredientsText: 'vitamin c, gelatin'
      });
      expect(out.tiles.skin_type.reason_unavailable).toBe('not_applicable_skin_type_for_food');
    });

    test('A6: food side effects line is route-safe', () => {
      const out = makeResult({
        categoryRoute: 'food',
        ingredientsText: 'water, sugar, lactic acid'
      });
      expect(out.verdict.side_effects.summary).toBe('Not assessed in this scan.');
    });

    test('A7: food route uses food-specific missing_more copy', () => {
      const out = makeResult({
        categoryRoute: 'food',
        ingredientsText: 'water, sugar, red 40'
      });
      expect(out.missing_more.join(' ')).toMatch(/food|supplement|additive|dye|alternatives/i);
    });

    test('A8: cosmetic route keeps cosmetic tile heading semantics in contract', () => {
      const out = makeResult({
        categoryRoute: 'cosmetic',
        ingredientsText: 'water, niacinamide'
      });
      expect(out.semantic_contract.route).toBe('cosmetic');
    });
  });

  describe('Section B - children safety verdicts and enum guard', () => {
    test('B1: Red 40 triggers caution on food route', () => {
      const out = makeResult({
        categoryRoute: 'food',
        ingredientsText: 'corn syrup, red 40'
      });
      expect(out.verdict.children_safe.answer).toBe('caution');
      expect(out.verdict.children_safe.summary).toMatch(/dye|Red 40|Blue 1/i);
    });

    test('B2: clean food list returns safe', () => {
      const out = makeResult({
        categoryRoute: 'food',
        ingredientsText: 'water, apple puree concentrate'
      });
      expect(out.verdict.children_safe.answer).toBe('safe');
    });

    test('B3: Blue 1 triggers caution', () => {
      const out = makeResult({
        categoryRoute: 'food',
        ingredientsText: 'water, blue 1'
      });
      expect(out.verdict.children_safe.answer).toBe('caution');
    });

    test('B4: Yellow 5 triggers caution', () => {
      const out = makeResult({
        categoryRoute: 'food',
        ingredientsText: 'water, yellow 5'
      });
      expect(out.verdict.children_safe.answer).toBe('caution');
    });

    test('B5: high harmful severity forces caution regardless of route', () => {
      const out = makeResult({
        categoryRoute: 'cosmetic',
        ingredientsText: 'water',
        routineConflicts: [{ id: 'x', severity: 'high', summary: 'high conflict' }]
      });
      expect(out.verdict.children_safe.answer).toBe('caution');
    });

    test('B6: children_safe.answer remains in supported enum set', () => {
      const out = makeResult({
        categoryRoute: 'food',
        ingredientsText: 'water, sugar'
      });
      expect(['safe', 'caution', 'insufficient_data']).toContain(out.verdict.children_safe.answer);
    });
  });

  describe('Section C - stub honesty and provenance integrity', () => {
    beforeEach(() => {
      process.env.RESULT_SUMMARY_REASONING_V1 = 'true';
      delete process.env.RESULT_SUMMARY_REASONING_MODEL_V1;
    });

    afterEach(() => {
      delete process.env.RESULT_SUMMARY_REASONING_V1;
      delete process.env.RESULT_SUMMARY_REASONING_MODEL_V1;
      ReasoningService.__resetReasoningProviderForTests();
    });

    test('C1: stub mode reports deterministic-stub and never model mode', async () => {
      const patch = await ReasoningService.buildReasoningPatch({
        snapshot: {
          scanned_product: { category_route: 'food', ingredients_text: 'water, sugar' },
          result_summary: { tiles: { skin_type: { status: 'deferred' } } }
        },
        inputHash: 'stub-c1'
      });
      expect(patch.reasoning_mode).toBe('stub');
      expect(patch.reasoning_model).toBe('deterministic-stub');
    });

    test('C2: stub alternatives candidates stay empty', async () => {
      const patch = await ReasoningService.buildReasoningPatch({
        snapshot: {
          scanned_product: { category_route: 'cosmetic', ingredients_text: 'water, niacinamide' },
          result_summary: { tiles: { skin_type: { status: 'deferred' } } }
        },
        inputHash: 'stub-c2'
      });
      expect(Array.isArray(patch.verdict.alternatives.candidates)).toBe(true);
      expect(patch.verdict.alternatives.candidates).toEqual([]);
    });

    test('C3: stub does not emit fabricated doc_id references', async () => {
      const patch = await ReasoningService.buildReasoningPatch({
        snapshot: {
          scanned_product: { category_route: 'food', ingredients_text: 'water, sugar' },
          result_summary: { tiles: { skin_type: { status: 'deferred' } } }
        },
        inputHash: 'stub-c3'
      });
      expect(patch.reasoning_claim_provenance).toEqual({});
    });

    test('C4: stub evidence refs are route-context only', async () => {
      const patch = await ReasoningService.buildReasoningPatch({
        snapshot: {
          scanned_product: { category_route: 'food', ingredients_text: 'water, sugar' },
          result_summary: { tiles: { skin_type: { status: 'deferred' } } }
        },
        inputHash: 'stub-c4'
      });
      expect(patch.reasoning_evidence_refs).toContain('route_context:food');
      expect(patch.reasoning_evidence_refs.some((x) => String(x).includes('doc_id_ref'))).toBe(false);
    });

    test('C5: stub path never hardcodes product alternatives', async () => {
      const patch = await ReasoningService.buildReasoningPatch({
        snapshot: {
          scanned_product: { category_route: 'cosmetic', ingredients_text: 'water, niacinamide' },
          result_summary: { tiles: { skin_type: { status: 'deferred' } } }
        },
        inputHash: 'stub-c5'
      });
      const joined = patch.verdict.alternatives.candidates.join(' ').toLowerCase();
      expect(joined).not.toMatch(/cerave|ordinary|la roche|neutrogena|vichy/);
    });

    test('C6: fallback mode is deterministic_fallback for invalid model output', async () => {
      process.env.RESULT_SUMMARY_REASONING_MODEL_V1 = 'true';
      jest.resetModules();
      const LocalReasoningService = require('../services/result-summary-reasoning-service');
      LocalReasoningService.__setModelCallerForTests(async () => ({
        model: 'test-model',
        version: 'test-model',
        rawText: 'invalid-json',
        usage: { input_tokens: 10, output_tokens: 5 }
      }));
      const patch = await LocalReasoningService.buildReasoningPatch({
        snapshot: {
          scanned_product: { category_route: 'food', ingredients_text: 'water, sugar' },
          result_summary: { tiles: { skin_type: { status: 'deferred' } } }
        },
        inputHash: 'stub-c6'
      });
      expect(patch.reasoning_mode).toBe('deterministic_fallback');
      LocalReasoningService.__resetReasoningProviderForTests();
    });

    test('C7: route context includes language for localization parity', async () => {
      const patch = await ReasoningService.buildReasoningPatch({
        snapshot: {
          preferred_language: 'es',
          scanned_product: { category_route: 'food', ingredients_text: 'water, sugar' },
          result_summary: { tiles: { skin_type: { status: 'deferred' } } }
        },
        inputHash: 'stub-c7'
      });
      expect(patch.reasoning_route_context.language).toBe('es');
    });
  });

  describe('Section D - confidence gates and sanitizer', () => {
    test('D1: low-confidence harmful reasoning is deferred', () => {
      const base = makeResult({
        categoryRoute: 'cosmetic',
        ingredientsText: 'water, niacinamide'
      });
      const out = applyReasoningPatch(base, {
        verdict: {
          harmful: {
            top_evidence: 'speculative',
            top_evidence_confidence: 0.1
          }
        }
      }, { enabled: true });
      expect(out.verdict.harmful.reason_unavailable).toBe('reasoning_low_confidence');
    });

    test('D2: low-confidence good_for_me summary is deferred', () => {
      const base = makeResult({
        categoryRoute: 'cosmetic',
        ingredientsText: 'water, niacinamide'
      });
      const out = applyReasoningPatch(base, {
        verdict: {
          good_for_me: {
            summary: 'speculative',
            summary_confidence: 0.1
          }
        }
      }, { enabled: true });
      expect(out.verdict.good_for_me.reason_unavailable).toBe('reasoning_low_confidence');
    });

    test('D3: low-confidence alternatives are deferred', () => {
      const base = makeResult({
        categoryRoute: 'cosmetic',
        ingredientsText: 'water, niacinamide'
      });
      const out = applyReasoningPatch(base, {
        reasoning_claim_provenance: {
          'verdict.alternatives.candidates': [{ source: 'model_reasoning:direct' }]
        },
        verdict: {
          alternatives: {
            candidates: ['Example alternative'],
            candidates_confidence: 0.1
          }
        }
      }, { enabled: true });
      expect(out.verdict.alternatives.reason_unavailable).toBe('reasoning_low_confidence');
    });

    test('D4: disabled reasoning leaves deterministic status disabled', () => {
      const out = makeResult({
        categoryRoute: 'food',
        ingredientsText: 'water, sugar',
        reasoningEnabled: false
      });
      expect(out.reasoning.enabled).toBe(false);
      expect(out.reasoning.status).toBe('disabled');
    });

    test('D5: unsupported route field updates are rejected', () => {
      const base = makeResult({
        categoryRoute: 'food',
        ingredientsText: 'water, sugar'
      });
      const out = applyReasoningPatch(base, {
        verdict: {
          good_for_me: {
            summary: 'Targets anti_aging',
            summary_confidence: 0.95
          }
        }
      }, { enabled: true });
      expect(out.verdict.good_for_me.reason_unavailable).toBe('unsupported_for_route');
    });

    test('D6: medical claim sanitizer removes diagnosis/cure language', () => {
      const clean = sanitizeReasoningText('This can diagnose acne and cure eczema quickly.');
      expect(clean.toLowerCase()).not.toMatch(/diagnose|cure/);
    });
  });

  describe('Section E - Welch food-route end-to-end regression', () => {
    const welchIngredients = [
      'Corn Syrup',
      'Sugar',
      'Modified Corn Starch',
      'Gelatin',
      'Citric Acid',
      'Lactic Acid',
      'Natural And Artificial Flavor',
      'Ascorbic Acid',
      'Red 40',
      'Blue 1'
    ].join(', ');

    test('E1: route is food', () => {
      const out = makeResult({ categoryRoute: 'food', ingredientsText: welchIngredients });
      expect(out.semantic_contract.route).toBe('food');
    });

    test('E2: key_actives is unavailable for food route', () => {
      const out = makeResult({ categoryRoute: 'food', ingredientsText: welchIngredients });
      expect(out.tiles.key_actives.status).toBe('unavailable');
    });

    test('E3: function is unavailable for food route', () => {
      const out = makeResult({ categoryRoute: 'food', ingredientsText: welchIngredients });
      expect(out.tiles.function.status).toBe('unavailable');
    });

    test('E4: skin_type is deferred with non-cosmetic reason code', () => {
      const out = makeResult({ categoryRoute: 'food', ingredientsText: welchIngredients });
      expect(out.tiles.skin_type.reason_unavailable).toBe('not_applicable_skin_type_for_food');
    });

    test('E5: no cosmetic harmful flags emitted', () => {
      const out = makeResult({ categoryRoute: 'food', ingredientsText: welchIngredients });
      const flags = (out.verdict.harmful.flags || []).join(' ').toLowerCase();
      expect(flags).not.toMatch(/retinoid|fragrance allergen|phenoxyethanol/);
    });

    test('E6: children-safe returns caution due to dyes', () => {
      const out = makeResult({ categoryRoute: 'food', ingredientsText: welchIngredients });
      expect(out.verdict.children_safe.answer).toBe('caution');
    });

    test('E7: side-effects remain route-safe for food acids', () => {
      const out = makeResult({ categoryRoute: 'food', ingredientsText: welchIngredients });
      expect(out.verdict.side_effects.summary).toBe('Not assessed in this scan.');
    });

    test('E8: alternatives footer remains deterministic CTA copy', () => {
      const out = makeResult({ categoryRoute: 'food', ingredientsText: welchIngredients });
      expect(String(out.verdict.alternatives.footer || '')).toMatch(/Ask Kelly/i);
    });

    test('E9: missing_more copy remains route-appropriate', () => {
      const out = makeResult({ categoryRoute: 'food', ingredientsText: welchIngredients });
      const joined = out.missing_more.join(' ');
      expect(joined).toMatch(/food|supplement|dye|alternatives/i);
      expect(joined).not.toMatch(/pediatric profile/i);
    });

    test('E10: no internal fallback reason strings in user-facing verdict summaries', () => {
      const out = makeResult({ categoryRoute: 'food', ingredientsText: welchIngredients });
      const text = JSON.stringify(out.verdict);
      expect(text).not.toMatch(/reasoning_disabled|reasoning_pending|reasoning_low_confidence/i);
    });
  });

  describe('Section F - voice metrics contract checks', () => {
    test('F1: scan metric names are accepted by contract guard', () => {
      expect(isAllowedLandingVoiceMetricName('scan.category_route.client_fallback_used')).toBe(true);
    });

    test('F2: voice timeline metric is accepted', () => {
      expect(isAllowedLandingVoiceMetricName('voice.timeline')).toBe(true);
    });

    test('F3: invalid metric name is rejected', () => {
      expect(isAllowedLandingVoiceMetricName('metrics.bad_name')).toBe(false);
    });
  });
});

