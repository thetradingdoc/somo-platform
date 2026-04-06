/**
 * Kelly phase / orchestration baseline tests (no live Kelly, no Retell).
 * Adapted to middleware-platform: kelly-orchestrator-phase.js API.
 */

'use strict';

const {
  KELLY_ORCHESTRATOR_PHASE,
  filterKellyToolsByPhase,
  mapToolDescriptionsForRoutineIntake,
  resolveOrchestrationPhase,
  buildOrchestrationPromptSection,
  shouldEscalateRoutineIntakeToTriage,
  SCHEDULING_TOOL_NAMES,
} = require('../services/kelly-orchestrator-phase');

/** Mirrors kelly-orchestrator-phase RETAIL_TOOL_NAMES (not exported from module). */
const RETAIL_TOOL_NAMES_LIST = [
  'get_product_quote',
  'get_cart',
  'add_to_cart',
  'update_cart_item',
  'remove_cart_item',
  'clear_cart',
  'save_shipping_address',
  'send_commerce_verification_code',
  'verify_commerce_code',
  'prepare_commerce_checkout',
  'get_checkout_payment_status',
];

// Minimal OpenAI-style tool list covering scheduling, retail, triage, derm
const MOCK_KELLY_TOOLS = [];
for (const name of SCHEDULING_TOOL_NAMES) {
  MOCK_KELLY_TOOLS.push({ type: 'function', function: { name } });
}
for (const name of RETAIL_TOOL_NAMES_LIST) {
  MOCK_KELLY_TOOLS.push({ type: 'function', function: { name } });
}
for (const name of [
  'get_triage_session',
  'store_triage_opqrst',
  'store_triage_rich_intake',
  'run_triage_rag',
  'request_document_upload',
  'query_patient_records',
  'search_medical_literature',
  'find_clinic_specialists',
  'end_call',
  'return_to_triage',
  'run_derm_patient_qa',
]) {
  MOCK_KELLY_TOOLS.push({ type: 'function', function: { name } });
}

const BOOKING_TOOLS = [...SCHEDULING_TOOL_NAMES];
const COMMERCE_TOOLS = [...RETAIL_TOOL_NAMES_LIST];
const TRIAGE_TOOLS = ['run_triage_rag', 'run_derm_patient_qa', 'request_document_upload'];

function getToolNames(tools) {
  if (!tools || tools.length === 0) return [];
  return tools.map((t) => (typeof t === 'string' ? t : t.name || t.function?.name)).filter(Boolean);
}

function filterPhase(phase, opts = {}) {
  return filterKellyToolsByPhase(MOCK_KELLY_TOOLS, phase, opts);
}

function leakedTools(phase, forbiddenList, opts = {}) {
  const allowed = getToolNames(filterPhase(phase, opts));
  return forbiddenList.filter((tool) => allowed.includes(tool));
}

/** Maps simplified session stubs to resolveOrchestrationPhase opts */
function resolvePhaseFromStub(sessionStub) {
  const triageComplete = !!sessionStub.triage_complete;
  const hasRag = sessionStub.has_rag !== undefined ? !!sessionStub.has_rag : false;
  const sessionRow =
    sessionStub.has_session_row === false
      ? null
      : {
          triage_complete: triageComplete ? 1 : 0,
          chief_complaint: sessionStub.chief_complaint ?? null,
        };

  const meta = { ...(sessionStub.meta || {}) };
  const db = {
    getTriageSession: () => sessionRow,
  };
  const KellyToolExecutor = {
    _getSessionMeta: (_sid, key) => (Object.prototype.hasOwnProperty.call(meta, key) ? meta[key] : null),
    _setSessionMeta: (_sid, key, val) => {
      meta[key] = val;
    },
  };
  const getLatestRag = () => (hasRag ? { id: 'rag-1' } : null);

  const result = resolveOrchestrationPhase({
    sessionId: 'test-session',
    message: String(sessionStub.message || ''),
    intentBucket: sessionStub.intentBucket ?? 'symptom',
    db,
    KellyToolExecutor,
    getLatestRag,
    routineLocked: !!sessionStub.routineLocked,
  });
  return result.phase;
}

// ════════════════════════════════════════════════════════════════════════
// BLOCK 1 — Tool allowlist enforcement
// ════════════════════════════════════════════════════════════════════════

describe('Block 1 — Tool allowlist enforcement', () => {
  describe('TRIAGE_DISCOVERY phase', () => {
    test('booking tools are NOT available', () => {
      const leaked = leakedTools(KELLY_ORCHESTRATOR_PHASE.TRIAGE_DISCOVERY, BOOKING_TOOLS);
      expect(leaked).toEqual([]);
    });

    test('commerce/cart tools are NOT available', () => {
      const leaked = leakedTools(KELLY_ORCHESTRATOR_PHASE.TRIAGE_DISCOVERY, COMMERCE_TOOLS);
      expect(leaked).toEqual([]);
    });

    test('triage tools ARE available', () => {
      const allowed = getToolNames(filterPhase(KELLY_ORCHESTRATOR_PHASE.TRIAGE_DISCOVERY));
      const hasTriage = TRIAGE_TOOLS.some((t) => allowed.includes(t));
      expect(hasTriage).toBe(true);
    });
  });

  describe('TRIAGE_ACTIVE phase', () => {
    test('booking tools are NOT available', () => {
      const leaked = leakedTools(KELLY_ORCHESTRATOR_PHASE.TRIAGE_ACTIVE, BOOKING_TOOLS);
      expect(leaked).toEqual([]);
    });

    test('commerce/cart tools are NOT available', () => {
      const leaked = leakedTools(KELLY_ORCHESTRATOR_PHASE.TRIAGE_ACTIVE, COMMERCE_TOOLS);
      expect(leaked).toEqual([]);
    });
  });

  describe('BOOKING phase', () => {
    test('scheduling tools ARE available in booking phase', () => {
      const allowed = getToolNames(filterPhase(KELLY_ORCHESTRATOR_PHASE.BOOKING));
      const hasScheduling = BOOKING_TOOLS.some((t) => allowed.includes(t));
      expect(hasScheduling).toBe(true);
    });

    test('triage tools are NOT available in booking phase', () => {
      const leaked = leakedTools(KELLY_ORCHESTRATOR_PHASE.BOOKING, ['run_triage_rag']);
      expect(leaked).toEqual([]);
    });
  });

  describe('ROUTINE_INTAKE phase', () => {
    test('phase constants exist and booking tools would be suppressed', () => {
      expect(KELLY_ORCHESTRATOR_PHASE).toHaveProperty('ROUTINE_INTAKE');
      expect(KELLY_ORCHESTRATOR_PHASE).toHaveProperty('ROUTINE_FOLLOWUP');
      const phase = KELLY_ORCHESTRATOR_PHASE.ROUTINE_INTAKE;
      const leaked = leakedTools(phase, BOOKING_TOOLS);
      expect(leaked).toEqual([]);
    });

    test('run_triage_rag is NOT available in routine intake', () => {
      const leaked = leakedTools(KELLY_ORCHESTRATOR_PHASE.ROUTINE_INTAKE, ['run_triage_rag']);
      expect(leaked).toEqual([]);
    });

    test('get_triage_session and store_triage_opqrst ARE available for Skin & Care persistence', () => {
      const names = filterKellyToolsByPhase(MOCK_KELLY_TOOLS, KELLY_ORCHESTRATOR_PHASE.ROUTINE_INTAKE, {
        includeDermEducation: false
      }).map((t) => t.function.name);
      expect(names).toEqual(expect.arrayContaining(['get_triage_session', 'store_triage_opqrst']));
    });

    test('mapToolDescriptionsForRoutineIntake replaces triage-steering copy for get_triage_session', () => {
      const tools = [
        {
          type: 'function',
          function: { name: 'get_triage_session', description: 'Get stored OPQRST. Call before run_triage_rag.' }
        }
      ];
      const out = mapToolDescriptionsForRoutineIntake(tools);
      expect(out[0].function.description).toMatch(/Skin & Care/i);
      // Override may name run_triage_rag only to forbid it — must not steer "call RAG after get session"
      expect(out[0].function.description).not.toMatch(/call before run_triage_rag|before run_triage_rag/i);
    });
  });

  describe('ROUTINE_FOLLOWUP phase', () => {
    test('run_triage_rag is NOT available (same allowlist as routine intake)', () => {
      const leaked = leakedTools(KELLY_ORCHESTRATOR_PHASE.ROUTINE_FOLLOWUP, ['run_triage_rag']);
      expect(leaked).toEqual([]);
    });
  });
});

// ════════════════════════════════════════════════════════════════════════
// BLOCK 2 — Phase transition logic (resolveOrchestrationPhase + mocks)
// ════════════════════════════════════════════════════════════════════════

describe('Block 2 — Phase transition signals', () => {
  test('phase does NOT advance to BOOKING when triage_complete is false (even if user wants appointment)', () => {
    const phase = resolvePhaseFromStub({
      triage_complete: false,
      chief_complaint: null,
      has_rag: false,
      message: 'I need to book an appointment',
      intentBucket: 'routine_booking',
    });
    expect(phase).not.toBe(KELLY_ORCHESTRATOR_PHASE.BOOKING);
  });

  test('phase advances to BOOKING when triage_complete and RAG exist', () => {
    const phase = resolvePhaseFromStub({
      triage_complete: true,
      chief_complaint: 'rash in armpits',
      has_rag: true,
      message: 'ok what times do you have',
    });
    expect(phase).toBe(KELLY_ORCHESTRATOR_PHASE.BOOKING);
  });

  test('ROUTINE_RECOMMEND is not a current phase constant (intake stub does not resolve to it)', () => {
    expect(KELLY_ORCHESTRATOR_PHASE).not.toHaveProperty('ROUTINE_RECOMMEND');
    const phase = resolvePhaseFromStub({
      triage_complete: false,
      intake_complete: false,
      chief_complaint: 'dry skin',
      has_session_row: true,
      has_rag: false,
    });
    expect(phase).not.toBe('ROUTINE_RECOMMEND');
  });

  test('phase is deterministic for the same stub inputs', () => {
    const session = {
      triage_complete: false,
      chief_complaint: 'headache',
      has_session_row: true,
      has_rag: false,
    };
    expect(resolvePhaseFromStub(session)).toBe(resolvePhaseFromStub(session));
  });

  test('ROUTINE_INTAKE when routine_intake_active and no medical escape', () => {
    const phase = resolvePhaseFromStub({
      meta: { routine_intake_active: '1' },
      has_session_row: false,
      has_rag: false,
      message: 'I want help building a skincare routine for dry skin',
      intentBucket: 'unknown',
    });
    expect(phase).toBe(KELLY_ORCHESTRATOR_PHASE.ROUTINE_INTAKE);
  });

  test('ROUTINE_INTAKE escalates to TRIAGE_ACTIVE on symptom signal (chest pain)', () => {
    const phase = resolvePhaseFromStub({
      meta: { routine_intake_active: '1' },
      has_session_row: false,
      has_rag: false,
      message: 'Actually I have chest pain and shortness of breath',
      intentBucket: 'symptom',
    });
    expect(phase).toBe(KELLY_ORCHESTRATOR_PHASE.TRIAGE_ACTIVE);
  });

  test('ROUTINE_INTAKE stays on negated rash (no substring false positive on "rash")', () => {
    const msg =
      "I don't have a rash or anything like that. My skin is pretty normal, maybe a little dry in winter.";
    expect(shouldEscalateRoutineIntakeToTriage(msg)).toBe(false);
    const phase = resolvePhaseFromStub({
      meta: { routine_intake_active: '1' },
      has_session_row: false,
      has_rag: false,
      message: msg,
      intentBucket: 'unknown',
    });
    expect(phase).toBe(KELLY_ORCHESTRATOR_PHASE.ROUTINE_INTAKE);
  });

  test('ROUTINE_FOLLOWUP when skincare intake complete, session row, no RAG (Option A)', () => {
    const phase = resolvePhaseFromStub({
      meta: {
        routine_intake_active: '1',
        intake_complete: '1',
        skincare_post_intake: '1'
      },
      has_session_row: true,
      has_rag: false,
      message: 'What should my morning routine look like?',
      intentBucket: 'unknown'
    });
    expect(phase).toBe(KELLY_ORCHESTRATOR_PHASE.ROUTINE_FOLLOWUP);
  });

  test('without skincare_post_intake, intake_complete + session row still resolves to TRIAGE_ACTIVE', () => {
    const phase = resolvePhaseFromStub({
      meta: { routine_intake_active: '1', intake_complete: '1' },
      has_session_row: true,
      has_rag: false,
      message: 'ok',
      intentBucket: 'unknown'
    });
    expect(phase).toBe(KELLY_ORCHESTRATOR_PHASE.TRIAGE_ACTIVE);
  });

  test('ROUTINE_FOLLOWUP escalates to TRIAGE_ACTIVE on chest pain after intake', () => {
    const phase = resolvePhaseFromStub({
      meta: {
        routine_intake_active: '1',
        intake_complete: '1',
        skincare_post_intake: '1'
      },
      has_session_row: true,
      has_rag: false,
      message: 'Wait — I have crushing chest pain',
      intentBucket: 'symptom'
    });
    expect(phase).toBe(KELLY_ORCHESTRATOR_PHASE.TRIAGE_ACTIVE);
  });
});

describe('shouldEscalateRoutineIntakeToTriage — negation', () => {
  test('false when user denies rash / swelling', () => {
    expect(shouldEscalateRoutineIntakeToTriage('No rash, just dry skin')).toBe(false);
    expect(shouldEscalateRoutineIntakeToTriage("I don't have any swelling")).toBe(false);
  });

  test('true when user affirms acute symptoms', () => {
    expect(shouldEscalateRoutineIntakeToTriage('I have a rash on my arm')).toBe(true);
    expect(shouldEscalateRoutineIntakeToTriage('Sudden chest pain')).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════
// BLOCK 3 — Orchestration prompt section per phase (buildOrchestrationPromptSection)
// ════════════════════════════════════════════════════════════════════════

describe('Block 3 — Prompt scope changes meaningfully per phase', () => {
  let triageSection;
  let bookingSection;

  beforeAll(() => {
    triageSection = buildOrchestrationPromptSection({
      phase: KELLY_ORCHESTRATOR_PHASE.TRIAGE_ACTIVE,
      triageReopen: false,
      escapeTriggered: false,
      stickyApplied: false,
    });
    bookingSection = buildOrchestrationPromptSection({
      phase: KELLY_ORCHESTRATOR_PHASE.BOOKING,
      triageComplete: true,
      hasRag: true,
      triageReopen: false,
      escapeTriggered: false,
      stickyApplied: false,
    });
  });

  test('triage orchestration section and booking section are different strings', () => {
    expect(triageSection).not.toBe(bookingSection);
  });

  test('sections differ by more than whitespace', () => {
    const normalize = (s) => s.replace(/\s+/g, ' ').trim();
    expect(normalize(triageSection)).not.toBe(normalize(bookingSection));
  });

  test('triage phase section states scheduling tools are NOT available this turn', () => {
    expect(triageSection.toLowerCase()).toContain('scheduling tools are not available');
  });

  test('booking phase section does NOT repeat the triage-only scheduling lock line', () => {
    expect(bookingSection.toLowerCase()).not.toContain('scheduling tools are not available');
  });

  test('booking section includes NEW-symptoms-during-booking line; ROUTINE_INTAKE does not (B4)', () => {
    expect(bookingSection.toLowerCase()).toContain('new symptoms during booking');
    const intakeSection = buildOrchestrationPromptSection({
      phase: KELLY_ORCHESTRATOR_PHASE.ROUTINE_INTAKE,
      triageReopen: false,
      escapeTriggered: false,
      stickyApplied: false,
    });
    expect(intakeSection.toLowerCase()).not.toContain('new symptoms during booking');
  });

  test('ROUTINE_INTAKE: orchestration section adds skincare-specific contract (not in generic footer)', () => {
    const intakeSection = buildOrchestrationPromptSection({
      phase: KELLY_ORCHESTRATOR_PHASE.ROUTINE_INTAKE,
      triageReopen: false,
      escapeTriggered: false,
    });
    const lower = intakeSection.toLowerCase();
    // Global footer mentions "do not schedule" for all phases — require intake-only copy.
    const hasSkincareIntakeContract =
      lower.includes('skincare') ||
      lower.includes('routine builder') ||
      lower.includes('current products') ||
      lower.includes('ingredient') ||
      /intake complete|collect (the )?routine|inci/i.test(lower);
    expect(hasSkincareIntakeContract).toBe(true);
  });

  test('ROUTINE_FOLLOWUP: orchestration section mentions post-assessment consumer mode', () => {
    const section = buildOrchestrationPromptSection({
      phase: KELLY_ORCHESTRATOR_PHASE.ROUTINE_FOLLOWUP,
      triageReopen: false,
      escapeTriggered: false,
      stickyApplied: false
    });
    const lower = section.toLowerCase();
    expect(lower).toMatch(/assessment is complete|personalised|personalized/);
    expect(lower).toContain('run_triage_rag');
  });

  test('orchestration sections are short (injected block, not full system prompt)', () => {
    const approxTokens = (str) => Math.ceil(str.split(/\s+/).filter(Boolean).length * 1.3);
    expect(approxTokens(triageSection)).toBeLessThan(400);
    expect(approxTokens(bookingSection)).toBeLessThan(400);
  });
});

// ════════════════════════════════════════════════════════════════════════
// BLOCK 4 — Skincare intake placeholder module (expand with real schema later)
// ════════════════════════════════════════════════════════════════════════

describe('Block 4 — Skincare intake schema', () => {
  let createIntakeSession;
  let validateIntakeComplete;

  beforeAll(() => {
    try {
      ({ createIntakeSession, validateIntakeComplete } = require('../services/skincare-intake'));
    } catch {
      createIntakeSession = null;
      validateIntakeComplete = null;
    }
  });

  test('skincare-intake service exists and exports createIntakeSession', () => {
    expect(createIntakeSession).not.toBeNull();
  });

  test('createIntakeSession returns required fields', () => {
    expect(createIntakeSession).not.toBeNull();
    const session = createIntakeSession({ patient_id: 'test-001' });
    expect(session).toMatchObject({
      chief_complaint: expect.anything(),
      history: expect.anything(),
      current_products: expect.any(Array),
      media_refs: expect.any(Array),
      cycle_data: expect.anything(),
      intake_complete: expect.any(Boolean),
      consent_flags: expect.any(Object),
    });
  });
});

afterAll(() => {
  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  KELLY PHASE VALIDATION — READING YOUR RESULTS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Block 1 → tool allowlists + BOOKING passes all tools (triage leak)
Block 2 → resolveOrchestrationPhase vs simple session flags
Block 3 → buildOrchestrationPromptSection (not full Kelly system prompt)
Block 4 → skincare-intake placeholder (services/skincare-intake.js)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);
});
