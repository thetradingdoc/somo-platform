'use strict';

jest.mock('../database', () => {
  const rules = [
    { id: 'r1', payer_id: 'BCBS_PILOT', plan_id: 'plan_x', code_pattern: '992*', covered: 1, copay_type: 'flat', copay_value: 35, requires_pa: 0, rule_version: '1' },
    { id: 'r2', payer_id: 'BCBS_PILOT', plan_id: 'plan_y', code_pattern: '992*', covered: 1, copay_type: 'flat', copay_value: 0, requires_pa: 0, rule_version: '1' },
    { id: 'r3', payer_id: 'BCBS_PILOT', plan_id: 'plan_pa', code_pattern: '992*', covered: 1, copay_type: 'flat', copay_value: 25, requires_pa: 1, rule_version: '1' }
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

const { computeVisitQuote, findMatchingRule } = require('../services/payer-quote-service');

describe('payer-quote-service', () => {
  test('pilot plan returns hard_number for 99213 + K21.0', async () => {
    const rule = findMatchingRule('BCBS_PILOT', 'plan_x', '99213');
    expect(rule).toBeTruthy();
    const quote = await computeVisitQuote({
      primary_icd10: 'K21.0',
      primary_cpt: '99213',
      payer_id: 'BCBS_PILOT',
      plan_id: 'plan_x',
      session_id: 'sess-test'
    });
    expect(quote.status).toBe('hard_number');
    expect(quote.copay_due_now).toBe(35);
  });

  test('unknown plan returns cannot_determine', async () => {
    const quote = await computeVisitQuote({
      primary_icd10: 'K21.0',
      primary_cpt: '99213',
      payer_id: 'BCBS_PILOT',
      plan_id: 'missing',
      session_id: 'sess-test'
    });
    expect(quote.status).toBe('cannot_determine');
  });

  test('missing codes returns cannot_determine', async () => {
    const quote = await computeVisitQuote({
      payer_id: 'BCBS_PILOT',
      plan_id: 'plan_x',
      session_id: 'sess-test'
    });
    expect(quote.status).toBe('cannot_determine');
  });

  test('fully covered plan returns hard_number with zero copay', async () => {
    const quote = await computeVisitQuote({
      primary_icd10: 'K21.0',
      primary_cpt: '99213',
      payer_id: 'BCBS_PILOT',
      plan_id: 'plan_y',
      session_id: 'sess-test'
    });
    expect(quote.status).toBe('hard_number');
    expect(quote.copay_due_now).toBe(0);
    expect(quote.covered).toBe(true);
  });

  test('requires PA flagged on matching rule', async () => {
    const quote = await computeVisitQuote({
      primary_icd10: 'K21.0',
      primary_cpt: '99213',
      payer_id: 'BCBS_PILOT',
      plan_id: 'plan_pa',
      session_id: 'sess-pa'
    });
    expect(quote.requires_pa).toBe(true);
    expect(quote.status).toBe('hard_number');
  });
});
