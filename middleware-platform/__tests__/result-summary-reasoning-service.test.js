describe('result-summary-reasoning-service', () => {
  let ReasoningService;

  beforeEach(() => {
    process.env.RESULT_SUMMARY_REASONING_V1 = 'true';
    jest.resetModules();
    ReasoningService = require('../services/result-summary-reasoning-service');
    ReasoningService.__resetReasoningProviderForTests();
  });

  afterEach(() => {
    delete process.env.RESULT_SUMMARY_REASONING_V1;
    delete process.env.RESULT_SUMMARY_REASONING_MODEL_V1;
    delete process.env.RESULT_SUMMARY_PINECONE_GROUNDING_V1;
    delete process.env.RESULT_SUMMARY_PINECONE_READINESS_V1;
    delete process.env.RESULT_SUMMARY_HAZARD_DICTIONARY_FORCE_UNAVAILABLE;
    ReasoningService.__resetReasoningProviderForTests();
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
    expect(patch.reasoning_route_context).toEqual({
      category_route: 'cosmetic',
      semantic_framing: 'cosmetic',
      cosmetic_steps_enabled: true,
      language: 'en'
    });
    expect(Array.isArray(patch.reasoning_evidence_refs)).toBe(true);
    expect(patch.reasoning_evidence_refs).toContain('route_context:cosmetic');
    expect(Array.isArray(patch.reasoning_retrieval_grounding?.keywords)).toBe(true);
    expect(patch.reasoning_claim_provenance).toEqual({});
    expect(patch.reasoning_mode).toBe('stub');
    expect(patch.reasoning_model).toBe('deterministic-stub');
    expect(patch.verdict.good_for_me.summary).toMatch(/Reasoning layer agrees|Reasoning unavailable/i);
    expect(Array.isArray(patch.verdict.alternatives.candidates)).toBe(true);
    expect(patch.verdict.alternatives.candidates).toEqual([]);
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
    expect(patch.reasoning_route_context).toEqual({
      category_route: 'food',
      semantic_framing: 'catalog_context',
      cosmetic_steps_enabled: false,
      language: 'en'
    });
    expect(patch.reasoning_evidence_refs).toContain('route_context:food');
    expect(patch.verdict.good_for_me.summary).toMatch(/catalog context|semantic contract/i);
    expect(Number(patch.verdict.side_effects.summary_confidence || 0)).toBeGreaterThanOrEqual(0.8);
    expect(patch.verdict.side_effects.summary).toMatch(/route-valid side-effect guidance/i);
    expect(patch.verdict.harmful.flags).toEqual([]);
    expect(Array.isArray(patch.verdict.alternatives.candidates)).toBe(true);
    expect(patch.verdict.alternatives.candidates.length).toBe(0);
  });

  test('builds model-backed patch when model path is enabled and output is valid', async () => {
    process.env.RESULT_SUMMARY_REASONING_MODEL_V1 = 'true';
    jest.resetModules();
    const LocalService = require('../services/result-summary-reasoning-service');
    LocalService.__setModelCallerForTests(async () => ({
      model: 'claude-sonnet-4-5',
      version: 'claude-sonnet-4-5',
      rawText: JSON.stringify({
        verdict: {
          good_for_me: {
            summary: 'Suitable for current profile context.',
            detail: 'No major routine conflict found.',
            summary_confidence: 0.91,
            detail_confidence: 0.9
          },
          harmful: {
            flags: ['Fragrance allergens present'],
            top_evidence: 'Fragrance and limonene detected.',
            summary: 'Potential irritation for sensitive skin.',
            flags_confidence: 0.89,
            top_evidence_confidence: 0.9,
            summary_confidence: 0.88
          },
          children_safe: { summary: 'Use caution for young children.', summary_confidence: 0.82 },
          side_effects: { summary: 'Possible tingling in sensitive skin.', summary_confidence: 0.86 },
          alternatives: { candidates: ['Fragrance-free moisturizer'], footer: 'Choose lower-irritation options.', candidates_confidence: 0.84 }
        },
        reasoning_confidence_global: 0.88,
        reasoning_evidence_summary: 'Direct model reasoning from provided context.'
      }),
      usage: { input_tokens: 120, output_tokens: 80 }
    }));

    const patch = await LocalService.buildReasoningPatch({
      snapshot: {
        scanned_product: {
          category_route: 'cosmetic',
          ingredients_text: 'Water, Fragrance, Limonene'
        },
        result_summary: { tiles: { skin_type: { status: 'available' } } }
      },
      inputHash: 'model123'
    });
    expect(patch.reasoning_mode).toBe('model');
    expect(patch.reasoning_model).toBe('claude-sonnet-4-5');
    expect(patch.reasoning_evidence_refs).toContain('model_reasoning:direct');
    expect(patch.reasoning_evidence_refs.some((x) => String(x).startsWith('hazard_dictionary:'))).toBe(true);
    expect(Array.isArray(patch.provenance_sources_available)).toBe(true);
    const hazardSource = patch.provenance_sources_available.find((x) => x?.source === 'hazard_dictionary');
    expect(hazardSource).toBeTruthy();
    expect(hazardSource.executed).toBe(true);
    expect(Array.isArray(patch.reasoning_claim_provenance['verdict.harmful.flags'])).toBe(true);
    expect(patch.reasoning_claim_provenance['verdict.harmful.flags'].some((x) => x?.source === 'hazard_dictionary')).toBe(true);
    expect(patch.verdict.good_for_me.summary).toMatch(/Suitable/i);
    expect(patch.verdict.alternatives.candidates.length).toBe(1);
    expect(patch.reasoning_cost.estimated_input_tokens).toBe(120);
  });

  test('fails closed to deterministic_fallback when model output is invalid JSON', async () => {
    process.env.RESULT_SUMMARY_REASONING_MODEL_V1 = 'true';
    jest.resetModules();
    const LocalService = require('../services/result-summary-reasoning-service');
    LocalService.__setModelCallerForTests(async () => ({
      model: 'claude-sonnet-4-5',
      version: 'claude-sonnet-4-5',
      rawText: 'not-json',
      usage: { input_tokens: 100, output_tokens: 10 }
    }));
    const patch = await LocalService.buildReasoningPatch({
      snapshot: {
        scanned_product: {
          category_route: 'food',
          ingredients_text: 'Water, Sugar'
        },
        result_summary: { tiles: { skin_type: { status: 'available' } } }
      },
      inputHash: 'fallback123'
    });
    expect(patch.reasoning_mode).toBe('deterministic_fallback');
    expect(patch.reasoning_evidence_refs).toEqual(['route_context:food']);
    expect(Array.isArray(patch.verdict.alternatives.candidates)).toBe(true);
    expect(patch.verdict.alternatives.candidates.length).toBe(0);
  });

  test('fails closed when model wraps JSON in markdown fences', async () => {
    process.env.RESULT_SUMMARY_REASONING_MODEL_V1 = 'true';
    jest.resetModules();
    const LocalService = require('../services/result-summary-reasoning-service');
    LocalService.__setModelCallerForTests(async () => ({
      model: 'claude-sonnet-4-5',
      version: 'claude-sonnet-4-5',
      rawText: '```json\n{"bad":"shape"}\n```',
      usage: { input_tokens: 70, output_tokens: 10 }
    }));
    const patch = await LocalService.buildReasoningPatch({
      snapshot: {
        scanned_product: { category_route: 'food', ingredients_text: 'Water, Sugar' },
        result_summary: { tiles: { skin_type: { status: 'available' } } }
      },
      inputHash: 'fallback-fenced'
    });
    expect(patch.reasoning_mode).toBe('deterministic_fallback');
    expect(patch.reasoning_model_telemetry.provider_error_class).toBe('non_json_output');
  });

  test('marks retrieval partial when vector source fails but hazard source works', async () => {
    process.env.RESULT_SUMMARY_REASONING_MODEL_V1 = 'true';
    process.env.RESULT_SUMMARY_PINECONE_GROUNDING_V1 = 'true';
    process.env.RESULT_SUMMARY_PINECONE_READINESS_V1 = 'true';
    jest.resetModules();
    jest.doMock('../services/vector-retriever', () => ({
      createVectorRetriever: () => ({})
    }));
    const LocalService = require('../services/result-summary-reasoning-service');
    LocalService.__setModelCallerForTests(async () => ({
      model: 'claude-sonnet-4-5',
      version: 'claude-sonnet-4-5',
      rawText: JSON.stringify({
        verdict: {
          good_for_me: { summary: 'ok', detail: 'ok', summary_confidence: 0.9, detail_confidence: 0.9 },
          harmful: {
            flags: ['Fragrance allergens present'],
            top_evidence: 'Fragrance detected',
            summary: 'Irritation risk',
            flags_confidence: 0.9,
            top_evidence_confidence: 0.9,
            summary_confidence: 0.9
          },
          children_safe: { summary: 'Caution', summary_confidence: 0.8 },
          side_effects: { summary: 'Possible irritation', summary_confidence: 0.8 },
          alternatives: { candidates: [], footer: 'none', candidates_confidence: 0.8 }
        },
        reasoning_confidence_global: 0.9,
        reasoning_evidence_summary: 'evidence'
      }),
      usage: { input_tokens: 90, output_tokens: 40 }
    }));
    const patch = await LocalService.buildReasoningPatch({
      snapshot: {
        scanned_product: { category_route: 'cosmetic', ingredients_text: 'Water, Fragrance' },
        result_summary: { tiles: { skin_type: { status: 'available' } } }
      },
      inputHash: 'partial-retrieval'
    });
    expect(patch.reasoning_retrieval.status).toBe('partial');
    expect(patch.reasoning_retrieval.failed_sources).toContain('ingredient_semantic_index');
    delete process.env.RESULT_SUMMARY_PINECONE_GROUNDING_V1;
    delete process.env.RESULT_SUMMARY_PINECONE_READINESS_V1;
  });

  test('marks retrieval failed when required hazard source is unavailable', async () => {
    process.env.RESULT_SUMMARY_REASONING_MODEL_V1 = 'true';
    process.env.RESULT_SUMMARY_HAZARD_DICTIONARY_FORCE_UNAVAILABLE = 'true';
    jest.resetModules();
    const LocalService = require('../services/result-summary-reasoning-service');
    LocalService.__setModelCallerForTests(async () => ({
      model: 'claude-sonnet-4-5',
      version: 'claude-sonnet-4-5',
      rawText: JSON.stringify({
        verdict: {
          good_for_me: { summary: 'ok', detail: 'ok', summary_confidence: 0.9, detail_confidence: 0.9 },
          harmful: {
            flags: [],
            top_evidence: 'None',
            summary: 'Unknown',
            flags_confidence: 0.9,
            top_evidence_confidence: 0.9,
            summary_confidence: 0.9
          },
          children_safe: { summary: 'Unknown', summary_confidence: 0.8 },
          side_effects: { summary: 'Unknown', summary_confidence: 0.8 },
          alternatives: { candidates: [], footer: 'none', candidates_confidence: 0.8 }
        },
        reasoning_confidence_global: 0.9,
        reasoning_evidence_summary: 'evidence'
      }),
      usage: { input_tokens: 50, output_tokens: 20 }
    }));
    const patch = await LocalService.buildReasoningPatch({
      snapshot: {
        scanned_product: { category_route: 'food', ingredients_text: 'Water, Sugar' },
        result_summary: { tiles: { skin_type: { status: 'available' } } }
      },
      inputHash: 'hazard-missing'
    });
    expect(patch.reasoning_retrieval.status).toBe('failed');
    expect(patch.reasoning_retrieval.failed_sources).toContain('hazard_dictionary');
  });

  test('forces empty model alternatives for non-cosmetic routes', async () => {
    process.env.RESULT_SUMMARY_REASONING_MODEL_V1 = 'true';
    jest.resetModules();
    const LocalService = require('../services/result-summary-reasoning-service');
    LocalService.__setModelCallerForTests(async () => ({
      model: 'claude-sonnet-4-5',
      version: 'claude-sonnet-4-5',
      rawText: JSON.stringify({
        verdict: {
          good_for_me: { summary: 'Food context', detail: 'Food detail', summary_confidence: 0.9, detail_confidence: 0.9 },
          harmful: {
            flags: [],
            top_evidence: 'ingredient evidence',
            summary: 'low concern',
            flags_confidence: 0.9,
            top_evidence_confidence: 0.9,
            summary_confidence: 0.9
          },
          children_safe: { summary: 'check dyes', summary_confidence: 0.9 },
          side_effects: { summary: 'not assessed', summary_confidence: 0.9 },
          alternatives: { candidates: ['Topical serum'], footer: 'should be removed', candidates_confidence: 0.95 }
        },
        reasoning_confidence_global: 0.9,
        reasoning_evidence_summary: 'direct'
      }),
      usage: { input_tokens: 100, output_tokens: 60 }
    }));
    const patch = await LocalService.buildReasoningPatch({
      snapshot: {
        scanned_product: { category_route: 'food', ingredients_text: 'water, sugar' },
        result_summary: { tiles: { skin_type: { status: 'available' } } }
      },
      inputHash: 'food-model-1'
    });
    expect(patch.reasoning_mode).toBe('model');
    expect(Array.isArray(patch.verdict.alternatives.candidates)).toBe(true);
    expect(patch.verdict.alternatives.candidates.length).toBe(0);
    expect(patch.reasoning_claim_provenance['verdict.alternatives.candidates']).toBeUndefined();
  });

  test('injects requested session language into model system prompt', async () => {
    process.env.RESULT_SUMMARY_REASONING_MODEL_V1 = 'true';
    jest.resetModules();
    const LocalService = require('../services/result-summary-reasoning-service');
    let capturedSystemPrompt = '';
    LocalService.__setModelCallerForTests(async (payload) => {
      capturedSystemPrompt = String(payload?.systemPrompt || '');
      return {
        model: 'claude-sonnet-4-5',
        version: 'claude-sonnet-4-5',
        rawText: JSON.stringify({
          verdict: {
            good_for_me: { summary: 'Resumen', detail: 'Detalle', summary_confidence: 0.9, detail_confidence: 0.9 },
            harmful: {
              flags: [],
              top_evidence: 'Evidencia',
              summary: 'Bajo riesgo',
              flags_confidence: 0.9,
              top_evidence_confidence: 0.9,
              summary_confidence: 0.9
            },
            children_safe: { summary: 'Precaucion', summary_confidence: 0.9 },
            side_effects: { summary: 'No evaluado', summary_confidence: 0.9 },
            alternatives: { candidates: [], footer: 'Sin alternativas', candidates_confidence: 0.9 }
          },
          reasoning_confidence_global: 0.9,
          reasoning_evidence_summary: 'Resumen de evidencia'
        }),
        usage: { input_tokens: 90, output_tokens: 50 }
      };
    });
    const patch = await LocalService.buildReasoningPatch({
      snapshot: {
        preferred_language: 'es',
        scanned_product: { category_route: 'food', ingredients_text: 'water, sugar' },
        result_summary: { tiles: { skin_type: { status: 'available' } } }
      },
      inputHash: 'lang-es-1'
    });
    expect(capturedSystemPrompt).toMatch(/Respond in language code: es/i);
    expect(patch.reasoning_route_context.language).toBe('es');
  });

  test('does not enqueue duplicate pending job for same session/snapshot/hash', () => {
    const spy = jest.spyOn(global, 'setImmediate').mockImplementation(() => 0);
    try {
      const uniq = String(Date.now());
      const first = ReasoningService.enqueueReasoningJob({
        sessionId: `sess-dup-${uniq}`,
        snapshotId: `snap-1-${uniq}`,
        snapshotVersion: 1,
        contextHash: `ctx-1-${uniq}`,
        inputHash: 'hash-1'
      });
      const second = ReasoningService.enqueueReasoningJob({
        sessionId: `sess-dup-${uniq}`,
        snapshotId: `snap-1-${uniq}`,
        snapshotVersion: 1,
        contextHash: `ctx-1-${uniq}`,
        inputHash: 'hash-1'
      });
      expect(first).toBe(true);
      expect(second).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });

  test('skips apply when queued snapshot is no longer latest', async () => {
    jest.resetModules();
    process.env.RESULT_SUMMARY_REASONING_V1 = 'true';
    jest.doMock('../services/session-result-snapshot-service', () => ({
      getLatestSessionResultSnapshot: jest.fn(() => ({
        snapshot_id: 'snap-newer',
        snapshot: { result_summary: { reasoning: { status: 'pending' } } }
      })),
      applySessionResultReasoningPatch: jest.fn()
    }));
    const LocalService = require('../services/result-summary-reasoning-service');
    const SnapshotService = require('../services/session-result-snapshot-service');
    LocalService.enqueueReasoningJob({
      sessionId: 'sess-stale',
      snapshotId: 'snap-old',
      snapshotVersion: 1,
      contextHash: 'ctx-stale',
      inputHash: 'hash-stale'
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(SnapshotService.applySessionResultReasoningPatch).not.toHaveBeenCalled();
    jest.dontMock('../services/session-result-snapshot-service');
  });
});
