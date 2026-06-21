'use strict';

const { resolveCptForVisit } = require('../utils/cpt-helper');
const { computeVisitQuote } = require('../services/payer-quote-service');

jest.mock('../database', () => {
  const rules = [
    { payer_id: 'BCBS_PILOT', plan_id: 'plan_x', code_pattern: '992*', covered: 1, copay_type: 'flat', copay_value: 35, requires_pa: 0 }
  ];
  return {
    db: {
      prepare: (sql) => ({
        all: (payer, plan) => rules.filter((r) => r.payer_id === payer && r.plan_id === plan),
        get: () => null,
        run: jest.fn()
      })
    },
    getTriageSession: jest.fn()
  };
});

describe('collect-insurance spine (Session 3)', () => {
  describe('resolveCptForVisit', () => {
    test('uses spine CPT when confidence meets threshold', () => {
      const r = resolveCptForVisit({
        spineCpt: '99213',
        confidence: 0.8,
        specialty: 'PrimaryCare'
      });
      expect(r.code_source).toBe('spine');
      expect(r.code).toBe('99213');
    });

    test('falls back with reason when confidence low', () => {
      const r = resolveCptForVisit({
        spineCpt: '99213',
        confidence: 0.2,
        specialty: 'PrimaryCare'
      });
      expect(r.code_source).toBe('fallback');
      expect(r.fallback_reason).toBe('low_confidence');
    });

    test('falls back when no spine cpt', () => {
      const r = resolveCptForVisit({ confidence: 0.9, specialty: 'PrimaryCare' });
      expect(r.code_source).toBe('fallback');
      expect(r.code).toMatch(/^992/);
    });
  });

  describe('missing codes block hard quote', () => {
    test('computeVisitQuote returns cannot_determine without icd/cpt', async () => {
      const quote = await computeVisitQuote({
        payer_id: 'BCBS_PILOT',
        plan_id: 'plan_x',
        session_id: 'sess-missing'
      });
      expect(quote.status).toBe('cannot_determine');
      expect(quote.copay_due_now).toBe(0);
    });

    test('computeVisitQuote returns hard_number with valid spine codes', async () => {
      const quote = await computeVisitQuote({
        primary_icd10: 'K21.0',
        primary_cpt: '99213',
        payer_id: 'BCBS_PILOT',
        plan_id: 'plan_x',
        session_id: 'sess-spine'
      });
      expect(quote.status).toBe('hard_number');
      expect(quote.copay_due_now).toBeGreaterThan(0);
    });
  });
});
