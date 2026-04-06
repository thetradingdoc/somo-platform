'use strict';

const KellyPromptBuilder = require('../services/kelly-prompt-builder');
const KellyOrchestratorPhase = require('../services/kelly-orchestrator-phase');

const { KELLY_ORCHESTRATOR_PHASE } = KellyOrchestratorPhase;

const { formatRoutineIntakeSummaryFromTriageRow, buildPhasePrompt } = KellyPromptBuilder;

describe('kelly-prompt-builder', () => {
  const prevPhase = process.env.KELLY_PHASE_PROMPTS;
  const prevOrch = process.env.KELLY_ORCHESTRATOR_PHASE;

  afterEach(() => {
    process.env.KELLY_PHASE_PROMPTS = prevPhase;
    process.env.KELLY_ORCHESTRATOR_PHASE = prevOrch;
  });

  test('phasePromptsEnabled is false when unset', () => {
    delete process.env.KELLY_PHASE_PROMPTS;
    expect(KellyPromptBuilder.phasePromptsEnabled()).toBe(false);
  });

  test('phasePromptsEnabled is true when KELLY_PHASE_PROMPTS=1', () => {
    process.env.KELLY_PHASE_PROMPTS = '1';
    expect(KellyPromptBuilder.phasePromptsEnabled()).toBe(true);
  });

  test('ROUTINE_INTAKE uses narrow prompt; orchestrator section after intake slice', () => {
    process.env.KELLY_PHASE_PROMPTS = '1';
    process.env.KELLY_ORCHESTRATOR_PHASE = '1';
    const ctx = {
      channel: 'chat',
      preferredLanguage: 'en',
      orchestration: { phase: KELLY_ORCHESTRATOR_PHASE.ROUTINE_INTAKE }
    };
    const out = KellyPromptBuilder.buildKellySystemPrompt(ctx, {
      buildLegacy: () => 'LEGACY_MONOLITH',
      languageDirective: () => ''
    });
    expect(out).not.toContain('LEGACY_MONOLITH');
    expect(out).toContain('Skin & Care');
    expect(out).toContain('Orchestrator state');
    expect(out.indexOf('Orchestrator state')).toBeGreaterThan(out.indexOf('Skin & Care'));
  });

  test('TRIAGE_DISCOVERY uses narrow triage slice when phase prompts enabled (F1)', () => {
    process.env.KELLY_PHASE_PROMPTS = '1';
    process.env.KELLY_ORCHESTRATOR_PHASE = '1';
    const ctx = {
      channel: 'chat',
      orchestration: { phase: KELLY_ORCHESTRATOR_PHASE.TRIAGE_DISCOVERY }
    };
    const out = KellyPromptBuilder.buildKellySystemPrompt(ctx, {
      buildLegacy: () => 'LEGACY_MONOLITH',
      languageDirective: () => ''
    });
    expect(out).not.toContain('LEGACY_MONOLITH');
    expect(out).toContain('symptom triage');
    expect(out).toMatch(/run_triage_rag/i);
    expect(out).toContain('Orchestrator state');
  });

  test('shared safety does not duplicate return_to_triage booking paragraph', () => {
    const block = KellyPromptBuilder.buildSharedSafetyBlock({
      channel: 'chat',
      preferredLanguage: 'en',
      languageDirective: () => ''
    });
    expect(block.toLowerCase()).toContain('911');
    expect(block).not.toMatch(/return_to_triage/i);
  });

  test('formatRoutineIntakeSummaryFromTriageRow builds INTAKE header when fields exist', () => {
    const md = formatRoutineIntakeSummaryFromTriageRow({
      quality: 'acne on cheeks',
      onset: '2 months',
      associated_sx: 'ceramide moisturizer nightly'
    });
    expect(md).toContain('INTAKE / TRIAGE SO FAR');
    expect(md).toContain('acne on cheeks');
    expect(md).toContain('ceramide');
  });

  test('formatRoutineIntakeSummaryFromTriageRow includes consumer OPQRST lines, media count, and gap extras', () => {
    const md = formatRoutineIntakeSummaryFromTriageRow(
      {
        quality: 'acne',
        onset: '3 months',
        severity: 4,
        timing: 'worse before period',
        radiation: 'jawline only',
        media_requested: 1,
        media_received: 1,
        media_ids: ['a', 'b']
      },
      { hardMissing: ['skin_type'], softGaps: ['triggers'] }
    );
    expect(md).toContain('How bothersome');
    expect(md).toContain('Pattern / timing');
    expect(md).toContain('Spread or other areas');
    expect(md).toMatch(/2 file reference/);
    expect(md).toContain('Still needed (server)');
    expect(md).toContain('Nice to clarify if time');
  });

  test('ROUTINE_INTAKE phase slice stays under sanity character ceiling (C2)', () => {
    const slice = buildPhasePrompt(KELLY_ORCHESTRATOR_PHASE.ROUTINE_INTAKE, { channel: 'chat' });
    expect(slice.length).toBeGreaterThan(200);
    expect(slice.length).toBeLessThan(6000);
  });

  test('ROUTINE_FOLLOWUP phase slice forbids run_triage_rag (consumer follow-up)', () => {
    const slice = buildPhasePrompt(KELLY_ORCHESTRATOR_PHASE.ROUTINE_FOLLOWUP, { channel: 'chat' });
    expect(slice.length).toBeGreaterThan(200);
    expect(slice.length).toBeLessThan(6000);
    expect(slice).toMatch(/do \*\*not\*\* run \*\*run_triage_rag/i);
  });

  test('F1: triage phase slices mention run_triage_rag and stay bounded', () => {
    for (const ph of [KELLY_ORCHESTRATOR_PHASE.TRIAGE_DISCOVERY, KELLY_ORCHESTRATOR_PHASE.TRIAGE_ACTIVE]) {
      const slice = buildPhasePrompt(ph, { channel: 'chat' });
      expect(slice).toMatch(/run_triage_rag/i);
      expect(slice.length).toBeLessThan(5000);
    }
  });

  test('F2–F4: booking, checkout, billing slices are non-empty and bounded', () => {
    const booking = buildPhasePrompt(KELLY_ORCHESTRATOR_PHASE.BOOKING, { channel: 'chat' });
    expect(booking).toMatch(/get_available_slots/i);
    expect(booking.length).toBeLessThan(5000);

    const checkout = buildPhasePrompt(KELLY_ORCHESTRATOR_PHASE.APPOINTMENT_CHECKOUT, { channel: 'chat' });
    expect(checkout).toMatch(/verify_checkout_code/i);
    expect(checkout.length).toBeLessThan(5000);

    const billing = buildPhasePrompt(KELLY_ORCHESTRATOR_PHASE.BILLING, { channel: 'chat' });
    expect(billing).toMatch(/get_patient_claims/i);
    expect(billing.length).toBeLessThan(5000);
  });

  test('buildKellySystemPrompt uses triage intro for TRIAGE_ACTIVE', () => {
    process.env.KELLY_PHASE_PROMPTS = '1';
    process.env.KELLY_ORCHESTRATOR_PHASE = '1';
    const ctx = {
      channel: 'chat',
      preferredLanguage: 'en',
      orchestration: { phase: KELLY_ORCHESTRATOR_PHASE.TRIAGE_ACTIVE }
    };
    const out = KellyPromptBuilder.buildKellySystemPrompt(ctx, {
      buildLegacy: () => 'LEGACY',
      languageDirective: () => ''
    });
    expect(out).toContain('symptom triage');
    expect(out).not.toContain('LEGACY');
  });
});
