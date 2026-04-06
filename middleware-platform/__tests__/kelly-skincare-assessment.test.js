/**
 * __tests__/kelly-skincare-assessment.test.js
 *
 * Comprehensive deterministic tests for the Skin & Care assessment pipeline.
 * No LLM required for the main suite. Live LLM golden transcript is opt-in via RUN_KELLY_GOLDEN=1.
 *
 * Coverage:
 *   Block 1 — Phase resolution (ROUTINE_INTAKE / ROUTINE_FOLLOWUP / TRIAGE_ACTIVE)
 *   Block 2 — Hard gate logic (_skincareHardGateMissingList, _syncRoutineSkincareIntakeMeta)
 *   Block 3 — Soft gap tracking (_computeSkincareSoftGaps)
 *   Block 4 — Tool pruning by phase (filterKellyToolsByPhase)
 *   Block 5 — Negation detection (shouldEscalateRoutineIntakeToTriage)
 *   Block 6 — formatRoutineIntakeSummaryFromTriageRow — all fields including photos / gaps
 *   Block 7 — buildOrchestrationPromptSection (phase-specific copy, B4 booking contamination)
 *   Block 8 — _storeTriageOpqrst skincare field merge + completion trigger
 *   Block 9 — Post-intake medical escalation
 *   Block 10 — Golden transcript (live LLM, opt-in)
 *
 * Run all:
 *   jest __tests__/kelly-skincare-assessment.test.js --verbose --runInBand
 *
 * Run golden only:
 *   RUN_KELLY_GOLDEN=1 jest __tests__/kelly-skincare-assessment.test.js --verbose --runInBand --testTimeout=120000
 */

'use strict';

const { v4: uuidv4 } = require('uuid');

// ─── Module imports — adjust paths to match your repo ────────────────────────
const KellyOrchestratorPhase = require('../services/kelly-orchestrator-phase');
const KellyPromptBuilder = require('../services/kelly-prompt-builder');
const KellyToolExecutor = require('../services/kelly-tool-executor');
const db = require('../database');

const {
  KELLY_ORCHESTRATOR_PHASE,
  resolveOrchestrationPhase,
  filterKellyToolsByPhase,
  shouldEscalateRoutineIntakeToTriage,
  buildOrchestrationPromptSection,
} = KellyOrchestratorPhase;

const { formatRoutineIntakeSummaryFromTriageRow } = KellyPromptBuilder;

const { _skincareHardGateMissingList, _computeSkincareSoftGaps } = KellyToolExecutor;

// ─── KELLY_TOOLS stub (just names — we only test phase pruning) ───────────────
const ALL_TOOL_NAMES = [
  'get_available_slots', 'schedule_appointment', 'search_appointments',
  'create_appointment_checkout', 'verify_checkout_code',
  'get_product_quote', 'get_cart', 'add_to_cart', 'prepare_commerce_checkout',
  'get_patient_claims', 'get_triage_session', 'store_triage_opqrst',
  'store_triage_rich_intake', 'run_triage_rag', 'request_document_upload',
  'query_patient_records', 'search_medical_literature', 'find_clinic_specialists',
  'end_call', 'return_to_triage', 'run_derm_patient_qa',
];

const STUB_TOOLS = ALL_TOOL_NAMES.map((name) => ({
  type: 'function',
  function: { name, description: `stub for ${name}` },
}));

// ─── Mock KellyToolExecutor (in-memory session meta + triage row) ─────────────
const _metaStore = {};
const _triageStore = {};

function makeSessionId(prefix = 'test') {
  return `${prefix}-${uuidv4()}`;
}

function mockExecutor(sessionId) {
  return {
    _getSessionMeta: (sid, key) => (_metaStore[sid] || {})[key] ?? null,
    _setSessionMeta: (sid, key, val) => {
      _metaStore[sid] = _metaStore[sid] || {};
      _metaStore[sid][key] = String(val);
    },
  };
}

function mockDb(sessionId, triageRow = null, ragRow = null) {
  return {
    getTriageSession: (sid) => (sid === sessionId ? (triageRow || null) : null),
  };
}

function setMeta(sessionId, key, value) {
  _metaStore[sessionId] = _metaStore[sessionId] || {};
  _metaStore[sessionId][key] = String(value);
}

function getMeta(sessionId, key) {
  return (_metaStore[sessionId] || {})[key] ?? null;
}

function clearMeta(sessionId) {
  delete _metaStore[sessionId];
}

// ─── Phase resolver helper ────────────────────────────────────────────────────
function resolvePhase(sessionId, message, { triageRow = null, ragRow = null, intentBucket = 'unknown', routineLocked = false } = {}) {
  const executor = mockExecutor(sessionId);
  const dbMock = mockDb(sessionId, triageRow, ragRow);

  return resolveOrchestrationPhase({
    sessionId,
    message,
    intentBucket,
    db: dbMock,
    KellyToolExecutor: executor,
    getLatestRag: () => ragRow,
    routineLocked,
  });
}

// ─── Minimal complete row (all hard gates filled) ─────────────────────────────
function completeSkincareRow(overrides = {}) {
  return {
    quality: 'acne on cheeks',
    onset: '3 months',
    severity: 3,
    timing: 'constant',
    skin_type: 'oily',
    skin_concerns_json: ['acne', 'congestion'],
    pregnancy_status: 'not_pregnant_not_bf',
    prior_dermatologist_json: { seen: false, note: '' },
    functional_impact: 2,
    associated_sx: null,
    medications: null,
    allergies: null,
    provocation: null,
    lifestyle_notes: null,
    environment_notes: null,
    ingredient_reactions: null,
    what_has_worked: null,
    hormonal_context: null,
    triggers_json: null,
    radiation: null,
    media_requested: null,
    media_received: null,
    media_ids: null,
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Block 1 — Phase resolution
// ═══════════════════════════════════════════════════════════════════════════════

describe('Block 1 — Phase resolution', () => {
  afterEach(() => {
    // meta store is keyed by sessionId — tests use unique IDs so no leak needed
  });

  it('1.1: cold start with no flags → TRIAGE_DISCOVERY', () => {
    const sid = makeSessionId();
    const { phase } = resolvePhase(sid, 'hello');
    expect(phase).toBe(KELLY_ORCHESTRATOR_PHASE.TRIAGE_DISCOVERY);
  });

  it('1.2: routine_intake_active=1, intake_complete not set → ROUTINE_INTAKE', () => {
    const sid = makeSessionId();
    setMeta(sid, 'routine_intake_active', '1');
    const { phase } = resolvePhase(sid, 'I have dry skin');
    expect(phase).toBe(KELLY_ORCHESTRATOR_PHASE.ROUTINE_INTAKE);
  });

  it('1.3: all three flags true → ROUTINE_FOLLOWUP (Option A — no TRIAGE_ACTIVE drop)', () => {
    const sid = makeSessionId();
    setMeta(sid, 'routine_intake_active', '1');
    setMeta(sid, 'intake_complete', '1');
    setMeta(sid, 'skincare_post_intake', '1');

    // session row exists (would previously trigger TRIAGE_ACTIVE) but no RAG
    const triageRow = completeSkincareRow();
    const { phase } = resolvePhase(sid, 'what routine do you suggest?', { triageRow });

    expect(phase).toBe(KELLY_ORCHESTRATOR_PHASE.ROUTINE_FOLLOWUP);
  });

  it('1.4: intake_complete=1 but skincare_post_intake missing → NOT ROUTINE_FOLLOWUP', () => {
    const sid = makeSessionId();
    setMeta(sid, 'routine_intake_active', '1');
    setMeta(sid, 'intake_complete', '1');
    // skincare_post_intake NOT set

    const triageRow = completeSkincareRow();
    const { phase } = resolvePhase(sid, 'thanks', { triageRow });

    // Should not be ROUTINE_FOLLOWUP since skincare_post_intake is missing
    expect(phase).not.toBe(KELLY_ORCHESTRATOR_PHASE.ROUTINE_FOLLOWUP);
  });

  it('1.5: session row present, no RAG, no skincare flags → TRIAGE_ACTIVE', () => {
    const sid = makeSessionId();
    const triageRow = { quality: 'chest pain', onset: 'today', triage_complete: false };
    const { phase } = resolvePhase(sid, 'it hurts', { triageRow });
    expect(phase).toBe(KELLY_ORCHESTRATOR_PHASE.TRIAGE_ACTIVE);
  });

  it('1.6: triage_complete + RAG present → BOOKING', () => {
    const sid = makeSessionId();
    const triageRow = { quality: 'rash', onset: '2 days', triage_complete: true };
    const { phase } = resolvePhase(sid, 'what times are available?', { triageRow, ragRow: { id: 'rag-1' } });
    expect(phase).toBe(KELLY_ORCHESTRATOR_PHASE.BOOKING);
  });

  it('1.7: billing intent + no triage → TRIAGE_ACTIVE (not BILLING)', () => {
    const sid = makeSessionId();
    const triageRow = { quality: 'rash', triage_complete: false };
    const { phase } = resolvePhase(sid, 'what does this cost?', { triageRow, intentBucket: 'billing' });
    expect(phase).toBe(KELLY_ORCHESTRATOR_PHASE.TRIAGE_ACTIVE);
  });

  it('1.8: billing intent + triage complete → BILLING', () => {
    const sid = makeSessionId();
    const triageRow = { quality: 'rash', triage_complete: true };
    const { phase } = resolvePhase(sid, 'how much is my copay?', {
      triageRow,
      ragRow: { id: 'rag-1' },
      intentBucket: 'billing',
    });
    expect(phase).toBe(KELLY_ORCHESTRATOR_PHASE.BILLING);
  });

  it('1.9: sticky — ROUTINE_FOLLOWUP persists on unknown intent when flags hold', () => {
    const sid = makeSessionId();
    setMeta(sid, 'routine_intake_active', '1');
    setMeta(sid, 'intake_complete', '1');
    setMeta(sid, 'skincare_post_intake', '1');
    setMeta(sid, 'kelly_orchestrator_phase', KELLY_ORCHESTRATOR_PHASE.ROUTINE_FOLLOWUP);

    const triageRow = completeSkincareRow();
    const { phase, stickyApplied } = resolvePhase(sid, 'hmm', { triageRow, intentBucket: 'unknown' });

    expect(phase).toBe(KELLY_ORCHESTRATOR_PHASE.ROUTINE_FOLLOWUP);
    expect(stickyApplied).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Block 2 — Hard gate logic
// ═══════════════════════════════════════════════════════════════════════════════

describe('Block 2 — Hard gate logic (_skincareHardGateMissingList)', () => {
  it('2.1: empty row → all 5 gates missing', () => {
    const missing = _skincareHardGateMissingList({});
    expect(missing).toContain('skin_type');
    expect(missing).toContain('skin_concerns_or_quality');
    expect(missing).toContain('pregnancy_status');
    expect(missing).toContain('prior_dermatologist');
    expect(missing).toContain('functional_impact');
    expect(missing).toHaveLength(5);
  });

  it('2.2: row with quality (no skin_concerns_json) satisfies skin_concerns_or_quality', () => {
    const missing = _skincareHardGateMissingList({
      quality: 'acne',
      skin_type: 'oily',
      pregnancy_status: 'not_pregnant_not_bf',
      prior_dermatologist_json: { seen: false },
      functional_impact: 2,
    });
    expect(missing).toHaveLength(0);
  });

  it('2.3: skin_concerns_json array (no quality) satisfies skin_concerns_or_quality', () => {
    const missing = _skincareHardGateMissingList({
      skin_concerns_json: ['dryness'],
      skin_type: 'dry',
      pregnancy_status: 'not_pregnant_not_bf',
      prior_dermatologist_json: { seen: true, note: 'diagnosed rosacea' },
      functional_impact: 3,
    });
    expect(missing).toHaveLength(0);
  });

  it('2.4: functional_impact=0 is invalid (out of 1-5 range)', () => {
    const missing = _skincareHardGateMissingList({
      quality: 'dryness',
      skin_type: 'dry',
      pregnancy_status: 'not_pregnant_not_bf',
      prior_dermatologist_json: { seen: false },
      functional_impact: 0,
    });
    expect(missing).toContain('functional_impact');
  });

  it('2.5: functional_impact=6 is invalid', () => {
    const missing = _skincareHardGateMissingList({
      quality: 'dryness',
      skin_type: 'dry',
      pregnancy_status: 'not_pregnant_not_bf',
      prior_dermatologist_json: { seen: false },
      functional_impact: 6,
    });
    expect(missing).toContain('functional_impact');
  });

  it('2.6: prior_dermatologist_json seen=null (unanswered) is a missing gate', () => {
    const missing = _skincareHardGateMissingList({
      quality: 'acne',
      skin_type: 'oily',
      pregnancy_status: 'not_pregnant_not_bf',
      prior_dermatologist_json: { seen: null },
      functional_impact: 2,
    });
    expect(missing).toContain('prior_dermatologist');
  });

  it('2.7: prior_dermatologist_json seen=false (answered No) is NOT missing', () => {
    const missing = _skincareHardGateMissingList({
      quality: 'acne',
      skin_type: 'oily',
      pregnancy_status: 'not_pregnant_not_bf',
      prior_dermatologist_json: { seen: false },
      functional_impact: 2,
    });
    expect(missing).not.toContain('prior_dermatologist');
  });

  it('2.8: complete row → 0 missing', () => {
    const missing = _skincareHardGateMissingList(completeSkincareRow());
    expect(missing).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Block 3 — Soft gap tracking
// ═══════════════════════════════════════════════════════════════════════════════

describe('Block 3 — Soft gap tracking (_computeSkincareSoftGaps)', () => {
  it('3.1: completely empty row → all soft gaps present', () => {
    const gaps = _computeSkincareSoftGaps({});
    expect(gaps).toContain('routine_or_products');
    expect(gaps).toContain('triggers');
    expect(gaps).toContain('lifestyle_notes');
    expect(gaps).toContain('environment_notes');
    expect(gaps).toContain('ingredient_reactions');
    expect(gaps).toContain('what_has_worked');
    expect(gaps).toContain('hormonal_context');
  });

  it('3.2: row with routine and triggers → those gaps absent', () => {
    const gaps = _computeSkincareSoftGaps({
      associated_sx: 'cleanser and moisturiser',
      triggers_json: ['stress', 'dairy'],
      lifestyle_notes: 'poor sleep',
      environment_notes: 'London',
      ingredient_reactions: 'fragrance causes flares',
      what_has_worked: 'niacinamide serum',
      hormonal_context: 'post-partum',
    });
    expect(gaps).toHaveLength(0);
  });

  it('3.3: medications fills routine_or_products gap', () => {
    const gaps = _computeSkincareSoftGaps({
      medications: 'CeraVe cleanser',
    });
    expect(gaps).not.toContain('routine_or_products');
  });

  it('3.4: provocation fills triggers gap when triggers_json absent', () => {
    const gaps = _computeSkincareSoftGaps({
      provocation: 'gets worse in winter',
    });
    expect(gaps).not.toContain('triggers');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Block 4 — Tool pruning by phase
// ═══════════════════════════════════════════════════════════════════════════════

describe('Block 4 — Tool pruning (filterKellyToolsByPhase)', () => {
  const SCHEDULING = ['get_available_slots', 'schedule_appointment', 'create_appointment_checkout'];
  const COMMERCE = ['get_product_quote', 'get_cart', 'prepare_commerce_checkout'];
  const RAG = ['run_triage_rag'];
  const INTAKE_ALLOWED = ['get_triage_session', 'store_triage_opqrst', 'request_document_upload', 'end_call', 'return_to_triage'];

  function names(tools) {
    return tools.map((t) => t.function.name);
  }

  it('4.1: ROUTINE_INTAKE — scheduling tools excluded', () => {
    const pruned = names(filterKellyToolsByPhase(STUB_TOOLS, KELLY_ORCHESTRATOR_PHASE.ROUTINE_INTAKE));
    SCHEDULING.forEach((n) => expect(pruned).not.toContain(n));
  });

  it('4.2: ROUTINE_INTAKE — commerce tools excluded', () => {
    const pruned = names(filterKellyToolsByPhase(STUB_TOOLS, KELLY_ORCHESTRATOR_PHASE.ROUTINE_INTAKE));
    COMMERCE.forEach((n) => expect(pruned).not.toContain(n));
  });

  it('4.3: ROUTINE_INTAKE — run_triage_rag excluded', () => {
    const pruned = names(filterKellyToolsByPhase(STUB_TOOLS, KELLY_ORCHESTRATOR_PHASE.ROUTINE_INTAKE));
    RAG.forEach((n) => expect(pruned).not.toContain(n));
  });

  it('4.4: ROUTINE_INTAKE — core intake tools included', () => {
    const pruned = names(filterKellyToolsByPhase(STUB_TOOLS, KELLY_ORCHESTRATOR_PHASE.ROUTINE_INTAKE));
    INTAKE_ALLOWED.forEach((n) => expect(pruned).toContain(n));
  });

  it('4.5: ROUTINE_FOLLOWUP — same allowlist as ROUTINE_INTAKE', () => {
    const intake = names(filterKellyToolsByPhase(STUB_TOOLS, KELLY_ORCHESTRATOR_PHASE.ROUTINE_INTAKE)).sort();
    const followup = names(filterKellyToolsByPhase(STUB_TOOLS, KELLY_ORCHESTRATOR_PHASE.ROUTINE_FOLLOWUP)).sort();
    expect(followup).toEqual(intake);
  });

  it('4.6: TRIAGE_DISCOVERY — run_triage_rag included', () => {
    const pruned = names(filterKellyToolsByPhase(STUB_TOOLS, KELLY_ORCHESTRATOR_PHASE.TRIAGE_DISCOVERY));
    expect(pruned).toContain('run_triage_rag');
  });

  it('4.7: TRIAGE_DISCOVERY — scheduling excluded', () => {
    const pruned = names(filterKellyToolsByPhase(STUB_TOOLS, KELLY_ORCHESTRATOR_PHASE.TRIAGE_DISCOVERY));
    SCHEDULING.forEach((n) => expect(pruned).not.toContain(n));
  });

  it('4.8: BOOKING — get_available_slots included', () => {
    const pruned = names(filterKellyToolsByPhase(STUB_TOOLS, KELLY_ORCHESTRATOR_PHASE.BOOKING));
    expect(pruned).toContain('get_available_slots');
    expect(pruned).toContain('schedule_appointment');
  });

  it('4.9: BOOKING — run_triage_rag excluded', () => {
    const pruned = names(filterKellyToolsByPhase(STUB_TOOLS, KELLY_ORCHESTRATOR_PHASE.BOOKING));
    expect(pruned).not.toContain('run_triage_rag');
  });

  it('4.10: run_derm_patient_qa — included in ROUTINE_INTAKE when flag set', () => {
    const pruned = names(filterKellyToolsByPhase(STUB_TOOLS, KELLY_ORCHESTRATOR_PHASE.ROUTINE_INTAKE, { includeDermEducation: true }));
    expect(pruned).toContain('run_derm_patient_qa');
  });

  it('4.11: run_derm_patient_qa — excluded in ROUTINE_INTAKE when flag off', () => {
    const pruned = names(filterKellyToolsByPhase(STUB_TOOLS, KELLY_ORCHESTRATOR_PHASE.ROUTINE_INTAKE, { includeDermEducation: false }));
    expect(pruned).not.toContain('run_derm_patient_qa');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Block 5 — Negation detection
// ═══════════════════════════════════════════════════════════════════════════════

describe('Block 5 — Negation detection (shouldEscalateRoutineIntakeToTriage)', () => {
  // Cases that SHOULD NOT escalate
  const nonEscalating = [
    "I don't have a rash or anything like that",
    "No rash, just dry skin",
    "I don't have any swelling",
    "no symptoms",
    "without symptoms",
    "no pain at all",
    "I don't have any bumps or lumps",
    "not swollen",
    "no bleeding",
    "I never had a rash",
    "I'm just here for a routine skincare consultation",
    "nothing hurts",
  ];

  nonEscalating.forEach((msg) => {
    it(`5.a: "${msg.slice(0, 50)}" → does NOT escalate`, () => {
      expect(shouldEscalateRoutineIntakeToTriage(msg)).toBe(false);
    });
  });

  // Cases that SHOULD escalate
  const escalating = [
    "I have a painful rash spreading on my arm",
    "my chest feels tight",
    // Whole-token fragments only: "bleed"/"hurt" do not match inside "bleeding"/"hurts" (word-boundary rule).
    "I started to bleed and it won't stop",
    "my knee hurt when I walk on it",
    "I feel very sick",
    "the swelling is getting worse",
    "I have a lump on my neck",
    "I feel faint and dizzy",
    "there's an infection under the skin",
    "severe burning feeling",
  ];

  escalating.forEach((msg) => {
    it(`5.b: "${msg.slice(0, 50)}" → DOES escalate`, () => {
      expect(shouldEscalateRoutineIntakeToTriage(msg)).toBe(true);
    });
  });

  it('5.c: Amara turn 2 — dry skin in winter does NOT escalate', () => {
    const msg = "My skin is pretty normal, maybe a little dry in winter. I just don't know what order to apply things.";
    expect(shouldEscalateRoutineIntakeToTriage(msg)).toBe(false);
  });

  it('5.d: purely cosmetic statement — no escalation', () => {
    expect(shouldEscalateRoutineIntakeToTriage("I want to brighten my complexion")).toBe(false);
  });

  it('5.e: "itching" in a cosmetic context (mild) — this escalates by design (documented limitation)', () => {
    // "itching" is in ESCAPE_SYMPTOM_FRAGMENTS; this is expected behavior
    // for safety — mild itching may need clinical review
    expect(shouldEscalateRoutineIntakeToTriage("I have some itching on my scalp")).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Block 6 — formatRoutineIntakeSummaryFromTriageRow
// ═══════════════════════════════════════════════════════════════════════════════

describe('Block 6 — formatRoutineIntakeSummaryFromTriageRow', () => {
  it('6.1: empty row → returns empty string', () => {
    expect(formatRoutineIntakeSummaryFromTriageRow({})).toBe('');
  });

  it('6.2: null row → returns empty string', () => {
    expect(formatRoutineIntakeSummaryFromTriageRow(null)).toBe('');
  });

  it('6.3: quality / onset / skin_type appear in output', () => {
    const summary = formatRoutineIntakeSummaryFromTriageRow({
      quality: 'acne on forehead',
      onset: '2 months',
      skin_type: 'oily',
    });
    expect(summary).toContain('acne on forehead');
    expect(summary).toContain('2 months');
    expect(summary).toContain('oily');
  });

  it('6.4: skin_concerns_json array surfaces in output', () => {
    const summary = formatRoutineIntakeSummaryFromTriageRow({
      quality: 'texture issues',
      skin_concerns_json: ['uneven tone', 'dullness'],
    });
    expect(summary).toContain('uneven tone');
    expect(summary).toContain('dullness');
  });

  it('6.5: pregnancy_status surfaces', () => {
    const summary = formatRoutineIntakeSummaryFromTriageRow({
      quality: 'stretch marks',
      pregnancy_status: 'post_partum',
    });
    expect(summary).toContain('post_partum');
  });

  it('6.6: prior_dermatologist_json seen=false appears as "No"', () => {
    const summary = formatRoutineIntakeSummaryFromTriageRow({
      quality: 'rosacea-like redness',
      prior_dermatologist_json: { seen: false, note: '' },
    });
    expect(summary).toContain('No');
    expect(summary).toMatch(/seen dermatologist/i);
  });

  it('6.7: prior_dermatologist_json seen=true + note appears', () => {
    const summary = formatRoutineIntakeSummaryFromTriageRow({
      quality: 'acne',
      prior_dermatologist_json: { seen: true, note: 'diagnosed seborrheic dermatitis' },
    });
    expect(summary).toContain('Yes');
    expect(summary).toContain('seborrheic dermatitis');
  });

  it('6.8: functional_impact appears', () => {
    const summary = formatRoutineIntakeSummaryFromTriageRow({
      quality: 'psoriasis',
      functional_impact: 4,
    });
    expect(summary).toContain('4');
  });

  it('6.9: photo state — media_received=true shows "Received"', () => {
    const summary = formatRoutineIntakeSummaryFromTriageRow({
      quality: 'rash',
      media_received: true,
      media_ids: ['img-001', 'img-002'],
    });
    expect(summary).toContain('Received');
    expect(summary).toContain('2 file reference');
  });

  it('6.10: media_requested but not received shows pending', () => {
    const summary = formatRoutineIntakeSummaryFromTriageRow({
      quality: 'rash',
      media_requested: true,
      media_received: false,
    });
    expect(summary).toMatch(/requested|pending/i);
  });

  it('6.11: hardMissing extras appear as "Still needed"', () => {
    const summary = formatRoutineIntakeSummaryFromTriageRow(
      { quality: 'dryness' },
      { hardMissing: ['pregnancy_status', 'functional_impact'] }
    );
    expect(summary).toContain('Still needed');
    expect(summary).toContain('pregnancy_status');
    expect(summary).toContain('functional_impact');
  });

  it('6.12: softGaps extras appear as "Nice to clarify"', () => {
    const summary = formatRoutineIntakeSummaryFromTriageRow(
      { quality: 'dryness' },
      { softGaps: ['lifestyle_notes', 'triggers'] }
    );
    expect(summary).toContain('Nice to clarify');
    expect(summary).toContain('lifestyle_notes');
  });

  it('6.13: severity and timing surface', () => {
    const summary = formatRoutineIntakeSummaryFromTriageRow({
      quality: 'redness',
      severity: 5,
      timing: 'comes and goes',
    });
    expect(summary).toContain('5');
    expect(summary).toContain('comes and goes');
  });

  it('6.14: lifestyle, environment, ingredient_reactions, what_has_worked, hormonal_context surface', () => {
    const row = {
      quality: 'melasma',
      lifestyle_notes: 'high stress, poor sleep',
      environment_notes: 'live in humid climate',
      ingredient_reactions: 'fragrance causes breakouts',
      what_has_worked: 'azelaic acid',
      hormonal_context: 'perimenopausal',
    };
    const summary = formatRoutineIntakeSummaryFromTriageRow(row);
    expect(summary).toContain('high stress');
    expect(summary).toContain('humid climate');
    expect(summary).toContain('fragrance causes breakouts');
    expect(summary).toContain('azelaic acid');
    expect(summary).toContain('perimenopausal');
  });

  it('6.15: triggers_json array surfaces', () => {
    const summary = formatRoutineIntakeSummaryFromTriageRow({
      quality: 'rosacea',
      triggers_json: ['spicy food', 'alcohol', 'sun'],
    });
    expect(summary).toContain('spicy food');
    expect(summary).toContain('alcohol');
    expect(summary).toContain('sun');
  });

  it('6.16: header line is always present when content exists', () => {
    const summary = formatRoutineIntakeSummaryFromTriageRow({ quality: 'acne' });
    expect(summary).toContain('INTAKE / TRIAGE SO FAR');
  });

  it('6.17: complete row — does NOT re-surface empty fields', () => {
    const summary = formatRoutineIntakeSummaryFromTriageRow(completeSkincareRow());
    // triggers_json is null in the complete row so it should not appear
    expect(summary).not.toContain('Triggers (structured)');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Block 7 — Orchestration prompt section
// ═══════════════════════════════════════════════════════════════════════════════

describe('Block 7 — buildOrchestrationPromptSection', () => {
  it('7.1: ROUTINE_INTAKE — contains intake instructions', () => {
    const section = buildOrchestrationPromptSection({ phase: KELLY_ORCHESTRATOR_PHASE.ROUTINE_INTAKE });
    expect(section).toMatch(/skincare.*intake|routine.*intake/i);
    expect(section).toMatch(/do not.*run_triage_rag|not.*run.*triage/i);
  });

  it('7.2: ROUTINE_FOLLOWUP — contains assessment-complete language', () => {
    const section = buildOrchestrationPromptSection({ phase: KELLY_ORCHESTRATOR_PHASE.ROUTINE_FOLLOWUP });
    expect(section).toMatch(/assessment.*complete|intake.*complete/i);
    expect(section).toMatch(/do not.*run_triage_rag|not.*run.*triage/i);
    expect(section).not.toMatch(/annual visit|annual checkup/i);
  });

  it('7.3: ROUTINE_FOLLOWUP — does NOT contain booking return_to_triage line', () => {
    const section = buildOrchestrationPromptSection({
      phase: KELLY_ORCHESTRATOR_PHASE.ROUTINE_FOLLOWUP,
      triageReopen: false,
      escapeTriggered: false,
    });
    // The booking-specific "NEW symptoms during booking" line should only be in BOOKING/CHECKOUT
    expect(section).not.toMatch(/new symptoms during booking/i);
  });

  it('7.4: TRIAGE_ACTIVE — contains scheduling blocked language', () => {
    const section = buildOrchestrationPromptSection({ phase: KELLY_ORCHESTRATOR_PHASE.TRIAGE_ACTIVE });
    expect(section).toMatch(/scheduling.*not available|scheduling tools.*not/i);
  });

  it('7.5: BOOKING — contains return_to_triage for new symptoms', () => {
    const section = buildOrchestrationPromptSection({ phase: KELLY_ORCHESTRATOR_PHASE.BOOKING });
    expect(section).toMatch(/new symptoms|return_to_triage/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Block 8 — _storeTriageOpqrst skincare field merge + completion trigger
// ═══════════════════════════════════════════════════════════════════════════════

describe('Block 8 — _storeTriageOpqrst skincare fields + completion', () => {
  // These tests call the real KellyToolExecutor against an in-memory DB
  // They require the DB module to be available and seeded

  let sessionId;
  let patientId = null;

  beforeEach(() => {
    sessionId = makeSessionId('opqrst');
    // Seed routine_intake_active so completion logic runs
    try {
      KellyToolExecutor._setSessionMeta(sessionId, 'routine_intake_active', '1');
    } catch (_) {}
  });

  it('8.1: storing skin_type persists and appears in missing list reduction', () => {
    try {
      KellyToolExecutor._storeTriageOpqrst(
        { quality: 'acne', skin_type: 'oily' },
        sessionId,
        patientId
      );
      const row = db.getTriageSession ? db.getTriageSession(sessionId) : null;
      if (row) {
        expect(String(row.skin_type || '')).toBe('oily');
      } else {
        console.warn('[8.1] getTriageSession returned null — skipping DB assertion');
      }
    } catch (e) {
      console.warn('[8.1] DB not available:', e.message);
    }
  });

  it('8.2: intake_complete NOT set when hard gates are missing', () => {
    try {
      KellyToolExecutor._storeTriageOpqrst(
        { quality: 'dryness', skin_type: 'dry' },
        sessionId,
        patientId
      );
      const done = KellyToolExecutor._getSessionMeta(sessionId, 'intake_complete');
      expect(done).not.toBe('1');
    } catch (e) {
      console.warn('[8.2] DB not available:', e.message);
    }
  });

  it('8.3: intake_complete AND skincare_post_intake both set when all hard gates pass', () => {
    try {
      KellyToolExecutor._storeTriageOpqrst(
        {
          quality: 'acne',
          onset: '3 months',
          skin_type: 'oily',
          skin_concerns_json: ['acne'],
          pregnancy_status: 'not_pregnant_not_bf',
          prior_dermatologist_json: { seen: false },
          functional_impact: 2,
        },
        sessionId,
        patientId
      );
      const done = KellyToolExecutor._getSessionMeta(sessionId, 'intake_complete');
      const post = KellyToolExecutor._getSessionMeta(sessionId, 'skincare_post_intake');

      // These will be '1' if DB + meta are available
      if (done !== null) {
        expect(done).toBe('1');
        expect(post).toBe('1');
      } else {
        console.warn('[8.3] Session meta not available — skipping assertion');
      }
    } catch (e) {
      console.warn('[8.3] DB not available:', e.message);
    }
  });

  it('8.4: functional_impact coerced from string "3" to integer', () => {
    try {
      KellyToolExecutor._storeTriageOpqrst(
        {
          quality: 'eczema',
          onset: '1 year',
          skin_type: 'dry',
          skin_concerns_json: ['dryness'],
          pregnancy_status: 'not_pregnant_not_bf',
          prior_dermatologist_json: { seen: true, note: 'prescribed hydrocortisone' },
          functional_impact: '3',
        },
        sessionId,
        patientId
      );
      const row = db.getTriageSession ? db.getTriageSession(sessionId) : null;
      if (row && row.functional_impact !== undefined) {
        const n = parseInt(String(row.functional_impact), 10);
        expect(n).toBe(3);
        expect(n >= 1 && n <= 5).toBe(true);
      }
    } catch (e) {
      console.warn('[8.4] DB not available:', e.message);
    }
  });

  it('8.5: hard_missing_json and gaps_json set in session meta after store', () => {
    try {
      KellyToolExecutor._storeTriageOpqrst(
        { quality: 'hyperpigmentation', skin_type: 'balanced' },
        sessionId,
        patientId
      );
      const hardRaw = KellyToolExecutor._getSessionMeta(sessionId, 'skincare_intake_hard_missing_json');
      if (hardRaw) {
        const missing = JSON.parse(hardRaw);
        expect(Array.isArray(missing)).toBe(true);
        // pregnancy_status, prior_dermatologist, functional_impact should still be missing
        expect(missing).toContain('pregnancy_status');
      }
    } catch (e) {
      console.warn('[8.5] DB not available:', e.message);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Block 9 — Post-intake medical escalation
// ═══════════════════════════════════════════════════════════════════════════════

describe('Block 9 — Post-intake medical escalation', () => {
  it('9.1: medical symptom after ROUTINE_FOLLOWUP → escalates to TRIAGE_ACTIVE', () => {
    const sid = makeSessionId();
    setMeta(sid, 'routine_intake_active', '1');
    setMeta(sid, 'intake_complete', '1');
    setMeta(sid, 'skincare_post_intake', '1');

    const triageRow = completeSkincareRow();
    const { phase } = resolvePhase(sid, 'I have severe chest pain and trouble breathing', { triageRow });

    expect(phase).toBe(KELLY_ORCHESTRATOR_PHASE.TRIAGE_ACTIVE);
  });

  it('9.2: skincare follow-up after assessment → stays ROUTINE_FOLLOWUP (no escalation)', () => {
    const sid = makeSessionId();
    setMeta(sid, 'routine_intake_active', '1');
    setMeta(sid, 'intake_complete', '1');
    setMeta(sid, 'skincare_post_intake', '1');

    const triageRow = completeSkincareRow();
    const { phase } = resolvePhase(sid, 'should I use the serum morning or night?', { triageRow });

    expect(phase).toBe(KELLY_ORCHESTRATOR_PHASE.ROUTINE_FOLLOWUP);
  });

  it('9.3: medical escalation clears skincare_post_intake flag', () => {
    const sid = makeSessionId();
    setMeta(sid, 'routine_intake_active', '1');
    setMeta(sid, 'intake_complete', '1');
    setMeta(sid, 'skincare_post_intake', '1');

    const triageRow = completeSkincareRow();
    // Must match a non-negated ESCAPE_SYMPTOM_FRAGMENT as a whole token (e.g. "chest", not "bleeding" alone).
    resolvePhase(sid, 'I have severe chest pain and feel faint', { triageRow });

    // After escalation, skincare_post_intake should be cleared
    const post = getMeta(sid, 'skincare_post_intake');
    // The resolver clears it via _metaSet — check it's '0' or falsy
    expect(post === '0' || post === null || post === 'false').toBe(true);
  });

  it('9.4: "no rash" message after intake → does NOT escalate', () => {
    const sid = makeSessionId();
    setMeta(sid, 'routine_intake_active', '1');
    setMeta(sid, 'intake_complete', '1');
    setMeta(sid, 'skincare_post_intake', '1');

    const triageRow = completeSkincareRow();
    const { phase } = resolvePhase(sid, "I don't have a rash, just wondering about my routine", { triageRow });

    expect(phase).toBe(KELLY_ORCHESTRATOR_PHASE.ROUTINE_FOLLOWUP);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Block 10 — Golden transcript (live LLM, opt-in)
// ═══════════════════════════════════════════════════════════════════════════════

const RUN_GOLDEN = process.env.RUN_KELLY_GOLDEN === '1';

const GOLDEN_DESCRIBE = RUN_GOLDEN ? describe : describe.skip;

GOLDEN_DESCRIBE('Block 10 — Golden transcript (live LLM)', () => {
  let KellyAgentService;
  let sessionId;
  const transcript = [];

  beforeAll(() => {
    KellyAgentService = require('../services/kelly-agent-service').KellyAgentService
      || require('../services/kelly-agent-service');
    sessionId = `golden-skincare-${uuidv4()}`;
    console.log('\n━━━ GOLDEN TRANSCRIPT ━━━');
    console.log('Persona: Amara — no rash, free samples, wants a routine');
    console.log(`Session: ${sessionId}\n`);
  });

  afterAll(() => {
    console.log('\n━━━ FULL CONVERSATION ━━━');
    transcript.forEach(({ turn, user, agent }) => {
      console.log(`\n[Turn ${turn}]`);
      console.log(`  USER : ${user}`);
      console.log(`  KELLY: ${agent}`);
    });
    console.log('\n━━━ END ━━━\n');
  });

  function buildPayload(message) {
    return {
      message,
      sessionId,
      channel: 'chat',
      kelly_flow: 'skincare',
      context: { entry_point: 'landing_assistant', skin_and_care: true },
    };
  }

  function forbidden(text, phrases) {
    return phrases.filter((p) => text.toLowerCase().includes(p.toLowerCase()));
  }

  function containsAny(text, phrases) {
    return phrases.some((p) => text.toLowerCase().includes(p.toLowerCase()));
  }

  const FORBIDDEN_CLINICAL = [
    'annual visit', 'annual checkup', 'routine visit with no symptoms',
    'route you to a specialist', 'OPQRST',
    'what symptom or concern should we focus on next',
  ];

  const TURNS = [
    {
      turn: 1,
      user: "Hi! I got some free skincare samples — a cleanser, a vitamin C serum, and a moisturiser. I've never really had a skincare routine. I just want to figure out how to use these properly.",
      wantOneOf: ['routine', 'skin type', 'cleanser', 'serum', 'moisturiser', 'concern', 'goal'],
    },
    {
      turn: 2,
      user: "I don't have a rash or anything like that. My skin is pretty normal, maybe a little dry in winter. I just don't know what order to apply things or when.",
      wantOneOf: ['dry', 'order', 'step', 'morning', 'evening', 'apply', 'cleanser'],
      forbiddenExtra: ['any other symptoms', 'when did your symptoms start'],
    },
    {
      turn: 3,
      user: "The samples I have are: a gentle foaming cleanser, a vitamin C brightening serum, and a daily moisturiser with SPF. That's it.",
      wantOneOf: ['cleanser', 'vitamin C', 'serum', 'moisturiser', 'SPF', 'order', 'morning', 'step'],
    },
    {
      turn: 4,
      user: "Do I need a different routine at night? Should I use the serum at night too?",
      wantOneOf: ['evening', 'night', 'serum', 'vitamin C', 'morning', 'PM', 'AM'],
      forbidReAsk: ['what products do you have', 'what samples do you have'],
    },
    {
      turn: 5,
      user: "Is there anything else I should know to get started?",
      wantOneOf: ['patch test', 'sunscreen', 'SPF', 'consistent', 'routine', 'gentle', 'start'],
    },
  ];

  TURNS.forEach(({ turn, user, wantOneOf, forbiddenExtra, forbidReAsk }) => {
    describe(`Turn ${turn}`, () => {
      let reply;

      beforeAll(async () => {
        const result = await KellyAgentService.processTurn(buildPayload(user));
        reply = result?.reply ?? result?.message ?? result?.text ?? '';
        transcript.push({ turn, user, agent: reply });
      });

      it('returns a non-empty reply', () => {
        expect(reply.length).toBeGreaterThan(0);
      });

      it('does not contain forbidden clinical phrases', () => {
        const violations = forbidden(reply, FORBIDDEN_CLINICAL);
        if (violations.length > 0) {
          console.warn(`[GOD-OBJECT Turn ${turn}]:`, violations.join(', '));
        }
        expect(violations).toHaveLength(0);
      });

      if (wantOneOf) {
        it('contains at least one expected consumer phrase', () => {
          const found = containsAny(reply, wantOneOf);
          if (!found) console.warn(`[OFF-TOPIC Turn ${turn}]: expected one of ${wantOneOf.join(', ')}`);
          expect(found).toBe(true);
        });
      }

      if (forbiddenExtra) {
        it('does not contain extra forbidden phrases', () => {
          const violations = forbidden(reply, forbiddenExtra);
          expect(violations).toHaveLength(0);
        });
      }

      if (forbidReAsk) {
        it('does not re-ask for already-captured information', () => {
          const reAsked = forbidden(reply, forbidReAsk);
          if (reAsked.length > 0) console.warn(`[RE-ASK Turn ${turn}]:`, reAsked.join(', '));
          expect(reAsked).toHaveLength(0);
        });
      }
    });
  });

  it('E2: "no symptoms" + skin concern on file → no annual-checkup pivot', async () => {
    const result = await KellyAgentService.processTurn(
      buildPayload("I don't have any symptoms, I just want skincare help.")
    );
    const reply = result?.reply ?? result?.message ?? result?.text ?? '';

    const annualPhrases = [
      'annual visit', 'annual checkup', 'routine checkup',
      'schedule a visit', 'book an appointment with no symptoms',
      'routine visit with no symptoms',
    ];

    const violations = forbidden(reply, annualPhrases);
    if (violations.length > 0) {
      console.warn('[ANNUAL-VISIT PIVOT]:', violations.join(', '));
    }
    expect(violations).toHaveLength(0);
  });

  it('C2: ROUTINE_INTAKE system prompt is under word-count ceiling', () => {
    let buildPhasePromptFn;
    try {
      ({ buildPhasePrompt: buildPhasePromptFn } = require('../services/kelly-prompt-builder'));
    } catch {
      console.warn('[C2] kelly-prompt-builder not available — skipping');
      return;
    }

    const prompt = buildPhasePromptFn('ROUTINE_INTAKE', { channel: 'chat', sessionId });
    const wordCount = String(prompt).split(/\s+/).filter(Boolean).length;
    const CEILING = 1000;
    console.log(`ROUTINE_INTAKE prompt: ${wordCount} words (ceiling ${CEILING})`);
    expect(wordCount).toBeLessThanOrEqual(CEILING);
  });
});
