'use strict';

jest.mock('../services/triage-rag-service', () => ({
  getAuthoritativeForSession: jest.fn(() => ({ rag_confidence: 0.85 }))
}));

const OpqrstFieldGate = require('../services/opqrst-field-gate');
const {
  opqrstComplete: sharedComplete,
  opqrstCompleteForSession
} = require('../services/kelly-rails/gates/shared');
const {
  applyReroutePreservingPartialTriage,
  promoteBookingWhenReady
} = require('../services/kelly-rails/execute-turn');
const { routeOrchestratorLane, KELLY_LANE } = require('../services/kelly-rails/state-schema');
const { evaluateTriageGuardrailsForSession } = require('../services/voice-triage-guards');

const ROWS = [
  { onset: '2 days', quality: 'sharp', severity: 7, timing: 'constant' },
  { onset: 'today', quality: 'dull', severity: 3, timing: 'comes and goes', provocation: 'walking' },
  { onset: '1 week', quality: 'burning', severity: null, timing: 'constant' },
  { onset: 'yesterday', quality: 'pressure', severity: 8, timing: 'constant', provocation: 'stress' }
];

const COMPLETE_ROW = {
  onset: 'today',
  quality: 'sharp',
  severity: 4,
  timing: 'constant',
  opqrst_complete: 1,
  triage_complete: 1,
  intake_complete_at: '2026-06-01T00:00:00.000Z'
};

const INCOMPLETE_ROW = {
  onset: 'today',
  quality: 'sharp',
  opqrst_complete: 0,
  triage_complete: 0
};

describe('opqrst-complete parity (A-3)', () => {
  describe('gate vs shared re-export', () => {
    test('gate and shared agree for sample triage rows', () => {
      for (const row of ROWS) {
        const gate = OpqrstFieldGate.opqrstComplete(row, { triagePolicy: 'conditional' });
        const shared = sharedComplete(row, 'conditional');
        expect(shared).toBe(gate);
      }
    });

    test('required policy requires provocation in both paths', () => {
      const row = { onset: '1d', quality: 'sharp', severity: 5, timing: 'constant' };
      expect(OpqrstFieldGate.opqrstComplete(row, { triagePolicy: 'required' })).toBe(false);
      expect(sharedComplete(row, 'required')).toBe(false);
      const withProv = { ...row, provocation: 'rest helps' };
      expect(OpqrstFieldGate.opqrstComplete(withProv, { triagePolicy: 'required' })).toBe(true);
      expect(sharedComplete(withProv, 'required')).toBe(true);
    });

    test('specialty defaults from target_specialty on row', () => {
      const row = {
        onset: '1d',
        quality: 'sharp',
        severity: 5,
        timing: 'constant',
        target_specialty: 'Psychiatry'
      };
      expect(sharedComplete(row)).toBe(true);
    });
  });

  describe('execute-turn reroute (C-6 / A-3)', () => {
    test('partial triage + resume field avoids clinical_intake reset', () => {
      const state = {
        active_lane: KELLY_LANE.CLINICAL,
        step: 'symptoms',
        flags: { opqrst_resume_field: 'provocation' }
      };
      const db = {
        getTriageSession: () => ({ onset: 'yesterday', quality: null, severity: null, timing: null })
      };
      applyReroutePreservingPartialTriage(
        state,
        { lane: KELLY_LANE.CLINICAL, step: 'clinical_intake' },
        db,
        'sess-reroute'
      );
      expect(state.step).toBe('medical_history');
      expect(state.active_lane).toBe(KELLY_LANE.CLINICAL);
    });

    test('no partial triage allows normal reroute step', () => {
      const state = { active_lane: KELLY_LANE.BOOKING, step: 'schedule_visit', flags: {} };
      const db = { getTriageSession: () => null };
      applyReroutePreservingPartialTriage(
        state,
        { lane: KELLY_LANE.CLINICAL, step: 'clinical_intake' },
        db,
        'sess-empty'
      );
      expect(state.step).toBe('clinical_intake');
    });
  });

  describe('promoteBookingWhenReady (A-3)', () => {
    const db = require('../database');

    beforeEach(() => {
      jest.spyOn(db, 'getTriageSession').mockImplementation(() => INCOMPLETE_ROW);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    test('blocks booking promotion when opqrst incomplete', async () => {
      const state = { active_lane: KELLY_LANE.CLINICAL, step: 'symptoms', flags: {} };
      await promoteBookingWhenReady(state, {
        message: 'book an appointment tomorrow',
        sessionId: 'sess-promote-block'
      });
      expect(state.active_lane).toBe(KELLY_LANE.CLINICAL);
      expect(state.step).toBe('symptoms');
    });

    test('promotes when opqrst complete per gate', async () => {
      db.getTriageSession.mockImplementation(() => ({
        ...COMPLETE_ROW,
        rag_result_id: 'rag-1'
      }));
      const state = { active_lane: KELLY_LANE.CLINICAL, step: 'triage_assessment', flags: {} };
      await promoteBookingWhenReady(state, {
        message: 'schedule a visit',
        sessionId: 'sess-promote-ok',
        patientId: 'pat-1'
      });
      expect(state.active_lane).toBe(KELLY_LANE.BOOKING);
      expect(state.step).toBe('schedule_visit');
    });
  });

  describe('routeOrchestratorLane booking gate (A-3)', () => {
    const db = require('../database');

    beforeEach(() => {
      jest.spyOn(db, 'getTriageSession').mockImplementation(() => COMPLETE_ROW);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    test('routes to booking when opqrst complete and booking intent', () => {
      const route = routeOrchestratorLane({
        session_id: 'sess-route',
        last_user_message: 'tomorrow at noon',
        flags: { basic_intake_complete: true }
      });
      expect(route.lane).toBe(KELLY_LANE.BOOKING);
    });

    test('does not route to booking when opqrst incomplete', () => {
      db.getTriageSession.mockImplementation(() => INCOMPLETE_ROW);
      const route = routeOrchestratorLane({
        session_id: 'sess-route-incomplete',
        last_user_message: 'tomorrow at noon',
        flags: { basic_intake_complete: true }
      });
      expect(route.lane).not.toBe(KELLY_LANE.BOOKING);
    });
  });

  describe('voice-triage-guards RAG gate (A-3)', () => {
    const db = require('../database');

    beforeEach(() => {
      jest.spyOn(db, 'getTriageSession');
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    test('OPQRST_REQUIRED when DB opqrst_complete false but fields look complete', () => {
      const row = {
        onset: 'today',
        quality: 'sharp',
        severity: 4,
        timing: 'constant',
        opqrst_complete: 0,
        triage_complete: 1,
        intake_complete_at: '2026-06-01T00:00:00.000Z'
      };
      db.getTriageSession.mockReturnValue(row);
      expect(OpqrstFieldGate.opqrstComplete(row)).toBe(true);
      const guard = evaluateTriageGuardrailsForSession('sess-guard', {}, 'schedule');
      expect(guard.ok).toBe(false);
      expect(guard.bump).toBe('opqrst_missing');
    });

    test('passes when DB opqrst_complete matches gate completion', () => {
      db.getTriageSession.mockReturnValue(COMPLETE_ROW);
      const guard = evaluateTriageGuardrailsForSession('sess-guard-ok', {}, 'schedule');
      expect(guard.ok).toBe(true);
    });
  });

  describe('store path alignment (A-1 / A-3)', () => {
    test('opqrstCompleteForSession matches gate for merged store row', () => {
      const merged = {
        onset: '2 days',
        quality: 'burning',
        severity: 6,
        timing: 'constant',
        target_specialty: 'Dermatology'
      };
      const gate = OpqrstFieldGate.opqrstComplete(merged, { triagePolicy: 'conditional' });
      const shared = opqrstCompleteForSession(merged, { clinicId: 'clinic-1' });
      expect(shared).toBe(gate);
      expect(gate).toBe(true);
    });

    test('hasPartialTriage aligns with incomplete gate rows', () => {
      const incomplete = { onset: 'today', quality: 'sharp' };
      expect(sharedComplete(incomplete)).toBe(false);
      expect(OpqrstFieldGate.hasPartialTriage(incomplete)).toBe(true);
      expect(sharedComplete(COMPLETE_ROW)).toBe(true);
      expect(OpqrstFieldGate.hasPartialTriage(COMPLETE_ROW)).toBe(true);
    });
  });
});
