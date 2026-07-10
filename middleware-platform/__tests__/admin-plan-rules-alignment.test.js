'use strict';

const { CLINIC_TRIGGER_MAP } = require('../services/resolve-admin-visit-codes');

jest.mock('../database', () => {
  const rules = [
    { payer_id: 'BCBS_PILOT', plan_id: 'plan_x', code_pattern: '992*', copay_value: 35 },
    { payer_id: 'BCBS_PILOT', plan_id: 'plan_x', code_pattern: '90834', copay_value: 30 },
    { payer_id: 'BCBS_PILOT', plan_id: 'plan_x', code_pattern: '99395', copay_value: 0 },
    { payer_id: 'BCBS_PILOT', plan_id: 'plan_x', code_pattern: '90471', copay_value: 20 },
    { payer_id: 'BCBS_PILOT', plan_id: 'plan_x', code_pattern: 'G0438', copay_value: 0 }
  ];
  return {
    db: {
      prepare: () => ({
        all: () => rules,
        get: () => null,
        run: jest.fn()
      })
    },
    getTriageSession: jest.fn()
  };
});

const { computeVisitQuote } = require('../services/payer-quote-service');

describe('admin plan_rules alignment (I-02)', () => {
  const coreCodes = [...new Set(CLINIC_TRIGGER_MAP.map((e) => e.code))].filter((c) =>
    /^(99|908|993|904|G04)/.test(c)
  );

  test.each(coreCodes.slice(0, 15))('plan_x quotes for admin code %s', async (code) => {
    const quote = await computeVisitQuote({
      payer_id: 'BCBS_PILOT',
      plan_id: 'plan_x',
      primary_cpt: code,
      primary_icd10: 'Z00.00',
      session_id: `admin-${code}`
    });
    expect(['hard_number', 'cannot_determine']).toContain(quote.status);
  });
});
