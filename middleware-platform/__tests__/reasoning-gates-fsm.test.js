'use strict';

const Metrics = require('../services/metrics');
const {
  buildScanSummary,
  buildResultSummary,
  applyReasoningPatch,
  SEMANTIC_CONTRACT_VERSION
} = require('../services/product-summary-service');
const ReasoningFsm = require('../services/reasoning-fsm-service');

jest.mock('../services/semantic-reject-audit-service', () => ({
  logSemanticReject: jest.fn()
}));

describe('reasoning gate stack + FSM helpers', () => {
  let incSpy;

  beforeEach(() => {
    incSpy = jest.spyOn(Metrics, 'increment').mockImplementation(() => {});
  });

  afterEach(() => {
    incSpy.mockRestore();
  });

  function cosmeticBase() {
    return buildResultSummary({
      scanSummary: buildScanSummary({
        product: { ingredients_text: 'Water, Niacinamide' },
        categoryRoute: 'cosmetic'
      }),
      product: { ingredients_text: 'Water, Niacinamide' },
      hasProfileContext: true,
      routineConflicts: [],
      categoryRoute: 'cosmetic',
      reasoningEnabled: false
    });
  }

  test('schema gate: contract mismatch skips apply and records gate decision', () => {
    const base = cosmeticBase();
    const badVersion = `${SEMANTIC_CONTRACT_VERSION}-stale`;
    const out = applyReasoningPatch(
      base,
      {
        semantic_contract_version: badVersion,
        verdict: {
          good_for_me: { summary: 'Should not land', summary_confidence: 0.99 }
        }
      },
      { enabled: true }
    );
    expect(out.reasoning.status).toBe('deferred');
    expect(out.reasoning.reasoning_gate_decision.schema_ok).toBe(false);
    expect(out.reasoning.reasoning_gate_decision.first_failure?.gate).toBe('schema');
    expect(incSpy).toHaveBeenCalledWith('reasoning.gate.schema.fail.count', 1);
  });

  test('semantic gate: forbidden vocabulary emits semantic_contract fail metric', () => {
    const base = buildResultSummary({
      scanSummary: buildScanSummary({
        product: { ingredients_text: 'water, sugar, niacinamide' },
        categoryRoute: 'food'
      }),
      product: { ingredients_text: 'water, sugar, niacinamide' },
      hasProfileContext: true,
      routineConflicts: [],
      categoryRoute: 'food',
      reasoningEnabled: false
    });
    applyReasoningPatch(
      base,
      {
        verdict: {
          good_for_me: {
            summary: 'Targets tone_evening for evening use.',
            summary_confidence: 0.95
          }
        }
      },
      { enabled: true }
    );
    expect(incSpy).toHaveBeenCalledWith('reasoning.gate.semantic_contract.fail.count', 1);
  });

  test('confidence gate: low confidence increments defer metric', () => {
    const base = cosmeticBase();
    applyReasoningPatch(
      base,
      {
        verdict: {
          harmful: { top_evidence: 'weak', top_evidence_confidence: 0.1 }
        }
      },
      { enabled: true }
    );
    expect(incSpy).toHaveBeenCalledWith('reasoning.gate.confidence.defer.count', 1);
  });

  test('safety gate: prescribing language is deferred with reasoning_safety_gate', () => {
    const base = cosmeticBase();
    const out = applyReasoningPatch(
      base,
      {
        verdict: {
          good_for_me: {
            summary: 'Your clinician may prescribe this for severe acne.',
            summary_confidence: 0.95
          }
        }
      },
      { enabled: true }
    );
    expect(out.verdict.good_for_me.reason_unavailable).toBe('reasoning_safety_gate');
    expect(incSpy).toHaveBeenCalledWith('reasoning.gate.safety.fail.count', 1);
    expect(out.reasoning.reasoning_gate_decision.first_failure?.gate).toBe('safety');
  });

  test('FSM: forbids complete -> pending', () => {
    expect(ReasoningFsm.canTransition('complete', 'pending').allowed).toBe(false);
  });

  test('FSM: forbids fallback -> pending', () => {
    expect(ReasoningFsm.canTransition('fallback', 'pending').allowed).toBe(false);
  });

  test('FSM: pending + applied -> complete', () => {
    const r = ReasoningFsm.computePostPatchSnapshotState({
      prevState: 'pending',
      reasoningStatus: 'applied',
      reasoningMode: 'model',
      providerErrorClass: null
    });
    expect(r.state).toBe('complete');
    expect(r.fallback_reason).toBe(ReasoningFsm.FALLBACK_REASON.NONE);
  });

  test('FSM: pending + deferred stub -> fallback with gate_or_confidence', () => {
    const r = ReasoningFsm.computePostPatchSnapshotState({
      prevState: 'pending',
      reasoningStatus: 'deferred',
      reasoningMode: 'stub',
      providerErrorClass: null
    });
    expect(r.state).toBe('fallback');
    expect(r.fallback_reason).toBe(ReasoningFsm.FALLBACK_REASON.GATE_OR_CONFIDENCE);
  });
});
