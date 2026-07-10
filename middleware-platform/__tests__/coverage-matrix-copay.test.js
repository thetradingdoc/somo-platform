'use strict';

/**
 * M-04 — Coverage matrix from pilot payer rules (BCBS plan_x / plan_y).
 */

jest.mock('../database', () => {
  const rules = [
    { id: 'r_em_x', payer_id: 'BCBS_PILOT', plan_id: 'plan_x', code_pattern: '992*', covered: 1, copay_type: 'flat', copay_value: 35, requires_pa: 0, rule_version: '1' },
    { id: 'r_mh_x', payer_id: 'BCBS_PILOT', plan_id: 'plan_x', code_pattern: '90834', covered: 1, copay_type: 'flat', copay_value: 30, requires_pa: 0, rule_version: '1' },
    { id: 'r_well_y', payer_id: 'BCBS_PILOT', plan_id: 'plan_y', code_pattern: '99395', covered: 1, copay_type: 'flat', copay_value: 0, requires_pa: 0, rule_version: '1' },
    { id: 'r_em_y', payer_id: 'BCBS_PILOT', plan_id: 'plan_y', code_pattern: '992*', covered: 1, copay_type: 'flat', copay_value: 0, requires_pa: 0, rule_version: '1' }
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

const { computeVisitQuote } = require('../services/payer-quote-service');

describe('coverage matrix copay (M-04)', () => {
  test('plan_x therapy 90834 → $30 hard_number', async () => {
    const quote = await computeVisitQuote({
      payer_id: 'BCBS_PILOT',
      plan_id: 'plan_x',
      primary_cpt: '90834',
      primary_icd10: 'F41.1',
      session_id: 'sess-m04-therapy'
    });
    expect(quote.status).toBe('hard_number');
    expect(quote.copay_due_now).toBe(30);
  });

  test('plan_x established E/M 99213 → $35', async () => {
    const quote = await computeVisitQuote({
      payer_id: 'BCBS_PILOT',
      plan_id: 'plan_x',
      primary_cpt: '99213',
      primary_icd10: 'Z00.00',
      session_id: 'sess-m04-em'
    });
    expect(quote.status).toBe('hard_number');
    expect(quote.copay_due_now).toBe(35);
  });

  test('plan_y wellness 99395 → $0', async () => {
    const quote = await computeVisitQuote({
      payer_id: 'BCBS_PILOT',
      plan_id: 'plan_y',
      primary_cpt: '99395',
      primary_icd10: 'Z00.00',
      session_id: 'sess-m04-wellness'
    });
    expect(quote.status).toBe('hard_number');
    expect(quote.copay_due_now).toBe(0);
  });

  test('unknown CPT without rule → cannot_determine', async () => {
    const quote = await computeVisitQuote({
      payer_id: 'BCBS_PILOT',
      plan_id: 'plan_x',
      primary_cpt: '99999',
      primary_icd10: 'Z00.00',
      session_id: 'sess-m04-unknown'
    });
    expect(quote.status).toBe('cannot_determine');
  });
});
