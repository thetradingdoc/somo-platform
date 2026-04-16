describe('result-summary-reasoning-service', () => {
  let ReasoningService;

  beforeEach(() => {
    process.env.RESULT_SUMMARY_REASONING_V1 = 'true';
    jest.resetModules();
    ReasoningService = require('../services/result-summary-reasoning-service');
  });

  afterEach(() => {
    delete process.env.RESULT_SUMMARY_REASONING_V1;
  });

  test('builds stable input hash from deterministic snapshot inputs', () => {
    const snapshot = {
      scanned_product: { product_name: 'Serum', ingredients_text: 'Water, Niacinamide', category_route: 'cosmetic' },
      routine_conflicts: [{ id: 'c1', severity: 'high', summary: 'Conflict detected' }],
      scan_summary: { tiles: { function: { value: ['oil_balance'] } } }
    };
    const a = ReasoningService.buildReasoningInputHash(snapshot);
    const b = ReasoningService.buildReasoningInputHash(snapshot);
    expect(a).toBe(b);
  });

  test('requests enqueue when reasoning metadata is missing or stale', () => {
    const snapshot = {
      scanned_product: { product_name: 'Serum', ingredients_text: 'Water, Niacinamide', category_route: 'cosmetic' },
      routine_conflicts: [],
      scan_summary: { tiles: {} },
      result_summary: { reasoning: { status: 'applied', reasoning_input_hash: 'old-hash' } }
    };
    const out = ReasoningService.shouldEnqueueReasoning({ snapshot });
    expect(out.shouldEnqueue).toBe(true);
    expect(out.reason).toBe('stale_input_hash');
  });

  test('builds field-scoped reasoning patch with evidence refs', async () => {
    const patch = await ReasoningService.buildReasoningPatch({
      snapshot: {
        scanned_product: {
          category_route: 'cosmetic',
          ingredients_text: 'Water, Niacinamide, Phenoxyethanol'
        },
        result_summary: {
          tiles: {
            skin_type: { status: 'available' }
          }
        },
        routine_conflicts: []
      },
      inputHash: 'abc123'
    });
    expect(patch.reasoning_model).toBeTruthy();
    expect(patch.reasoning_input_hash).toBe('abc123');
    expect(patch.semantic_contract_version).toBeTruthy();
    expect(Array.isArray(patch.reasoning_evidence_refs)).toBe(true);
    expect(Array.isArray(patch.reasoning_retrieval_grounding?.keywords)).toBe(true);
    expect(Array.isArray(patch.reasoning_claim_provenance['verdict.good_for_me.summary'])).toBe(true);
    expect(patch.verdict.good_for_me.summary).toMatch(/Reasoning layer agrees|Reasoning unavailable/i);
    expect(Array.isArray(patch.verdict.alternatives.candidates)).toBe(true);
  });

  test('uses route-scoped non-cosmetic reasoning framing for food route', async () => {
    const patch = await ReasoningService.buildReasoningPatch({
      snapshot: {
        scanned_product: {
          category_route: 'food',
          ingredients_text: 'Water, Vitamin C, Sugar'
        },
        result_summary: {
          semantic_contract: { route: 'food', verdict_framing: 'catalog_context' },
          tiles: { skin_type: { status: 'available' } }
        },
        routine_conflicts: []
      },
      inputHash: 'food123'
    });
    expect(patch.reasoning_input_hash).toBe('food123');
    expect(patch.verdict.good_for_me.summary).toMatch(/catalog context|semantic contract/i);
    expect(Number(patch.verdict.side_effects.summary_confidence || 0)).toBeGreaterThanOrEqual(0.8);
    expect(patch.verdict.side_effects.summary).toMatch(/route-valid side-effect guidance/i);
    expect(Array.isArray(patch.verdict.alternatives.candidates)).toBe(true);
    expect(patch.verdict.alternatives.candidates.length).toBe(0);
  });
});
