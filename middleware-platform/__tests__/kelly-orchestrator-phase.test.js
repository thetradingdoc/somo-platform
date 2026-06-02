'use strict';

const KellyOrchestratorPhase = require('../services/kelly-orchestrator-phase');

describe('KellyOrchestratorPhase', () => {
  describe('clinicClinicalMinimumIntakeMet', () => {
    it('returns true for OPQRST without skin type (OBGYN path)', () => {
      const sessionRow = {
        quality: 'pelvic pain',
        region: 'pelvis',
        severity: 4,
        onset: '2 weeks ago',
        target_specialty: 'Obstetrics and Gynecology',
      };
      const metaGet = () => null;
      expect(KellyOrchestratorPhase.clinicClinicalMinimumIntakeMet({ sessionRow, metaGet })).toBe(true);
      expect(
        KellyOrchestratorPhase.clinicMinimumIntakeMet({ sessionRow, metaGet })
      ).toBe(true);
    });
  });

  describe('clinicDermMinimumIntakeMet', () => {
    it('returns true when skin confirmed and OPQRST fields present', () => {
      const sessionRow = {
        quality: 'itchy rash',
        region: 'arm',
        severity: 3,
        onset: '1 week ago',
      };
      const metaGet = (key) => {
        if (key === 'step1_skin_type_status') return 'confirmed';
        if (key === 'step1_skin_type_value') return 'dry';
        return null;
      };
      expect(KellyOrchestratorPhase.clinicDermMinimumIntakeMet({ sessionRow, metaGet })).toBe(true);
    });

    it('returns false when skin type unknown', () => {
      const sessionRow = { quality: 'rash', region: 'arm', severity: 3, onset: '1 week' };
      const metaGet = () => null;
      expect(KellyOrchestratorPhase.clinicDermMinimumIntakeMet({ sessionRow, metaGet })).toBe(false);
    });
  });

  describe('filterKellyToolsByPhase BOOKING', () => {
    const mockTools = [
      { function: { name: 'get_available_slots' } },
      { function: { name: 'schedule_appointment' } },
      { function: { name: 'run_triage_rag' } },
      { function: { name: 'return_to_triage' } },
    ];

    it('allows scheduling tools and blocks triage RAG', () => {
      const filtered = KellyOrchestratorPhase.filterKellyToolsByPhase(
        mockTools,
        KellyOrchestratorPhase.KELLY_ORCHESTRATOR_PHASE.BOOKING
      );
      const names = filtered.map((t) => t.function.name);
      expect(names).toContain('get_available_slots');
      expect(names).toContain('schedule_appointment');
      expect(names).not.toContain('run_triage_rag');
      expect(names).toContain('return_to_triage');
    });
  });

  describe('resolveOrchestrationPhase booking progression', () => {
    const metaStore = {};
    const KellyToolExecutor = {
      _setSessionMeta: (sid, key, val) => {
        metaStore[`${sid}:${key}`] = String(val);
      },
      _getSessionMeta: (sid, key) => metaStore[`${sid}:${key}`] ?? null,
    };
    const db = {
      getTriageSession: () => ({
        triage_complete: 1,
        opqrst_complete: 1,
        quality: 'rash',
        region: 'arm',
        severity: 3,
        onset: '1 week',
        rag_result_id: 'rag-1',
      }),
    };

    it('resolves to BOOKING when triage complete and RAG present', () => {
      const result = KellyOrchestratorPhase.resolveOrchestrationPhase({
        sessionId: 'sess-booking-1',
        message: 'book appointment please',
        intentBucket: 'symptom',
        db,
        KellyToolExecutor,
        getLatestRag: () => ({ id: 'rag-1', rag_confidence: 0.9 }),
        routineLocked: false,
      });
      expect(result.phase).toBe(KellyOrchestratorPhase.KELLY_ORCHESTRATOR_PHASE.BOOKING);
    });
  });
});
