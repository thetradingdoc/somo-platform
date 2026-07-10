'use strict';

jest.mock('../database', () => ({
  db: {
    prepare: () => ({
      get: () => ({
        id: 'elig_sim',
        copay_amount: 20,
        eligible: 1,
        payer_id: 'BCBS_PILOT',
        service_code: '90834',
        eligibility_quality: 'simulate'
      }),
      run: jest.fn(),
      all: () => []
    })
  }
}));

jest.mock('../services/payer-quote-service', () => ({
  computeVisitQuote: jest.fn(async () => ({
    status: 'hard_number',
    copay_due_now: 30,
    source: 'plan_rules'
  }))
}));

const InsuranceService = require('../services/insurance-service');
const { resolveAmountDue } = require('../services/resolve-amount-due');
const { computeVisitQuote } = require('../services/payer-quote-service');

describe('M-01 simulate eligibility defers to plan_rules', () => {
  test('classifyEligibilityQuality marks simulate responses', () => {
    expect(
      InsuranceService.classifyEligibilityQuality({ eligible: true, copay: 20, _simulate: true })
    ).toBe('simulate');
  });

  test('resolveAmountDue skips simulate eligibility_checks and uses plan_rules', async () => {
    const result = await resolveAmountDue({
      patientId: 'pat_simulate_m01',
      payerId: 'BCBS_PILOT',
      planId: 'plan_x',
      serviceCode: '90834'
    });
    expect(computeVisitQuote).toHaveBeenCalled();
    expect(result.copay_due_now).toBe(30);
    expect(result.source).not.toBe('eligibility_checks');
  });

  test('M-02 simulate + CDT uses plan_rules not flat simulate copay', async () => {
    const db = require('../database');
    db.db = {
      prepare: () => ({
        get: () => ({
          id: 'elig_sim_dental',
          copay_amount: 25,
          eligible: 1,
          payer_id: 'DELTA_DENTAL_NY',
          service_code: 'D1110',
          eligibility_quality: 'simulate'
        })
      })
    };
    computeVisitQuote.mockResolvedValueOnce({
      status: 'hard_number',
      copay_due_now: 0,
      source: 'plan_rules'
    });
    const result = await resolveAmountDue({
      patientId: 'pat_dental_sim',
      payerId: 'DELTA_DENTAL_NY',
      planId: 'dental_ppo',
      serviceCode: 'D1110',
      tenantSpecialty: 'Dental'
    });
    expect(result.source).toBe('plan_rules');
    expect(result.copay_due_now).toBe(0);
  });
});
