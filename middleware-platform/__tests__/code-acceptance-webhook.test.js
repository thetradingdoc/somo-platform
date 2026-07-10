'use strict';

jest.mock('../database', () => {
  const rates = new Map();
  return {
    updateInsuranceClaim: jest.fn(),
    getInsuranceClaim: jest.fn(),
    upsertCodeAcceptance: jest.fn((payerId, cpt, accepted) => {
      const k = `${payerId}|${cpt}`;
      const cur = rates.get(k) || { acceptance_count: 0, denial_count: 0 };
      if (accepted) cur.acceptance_count++;
      else cur.denial_count++;
      rates.set(k, cur);
    }),
    getCodeAcceptanceRate: jest.fn((payerId, cpt) => rates.get(`${payerId}|${cpt}`)),
    db: null
  };
});

const InsuranceService = require('../services/insurance-service');
const { getHistoricalConfidence } = require('../services/code-acceptance-service');

describe('L-03 claim feedback → code_acceptance_rates', () => {
  test('applyClaimAdjudicationOutcome updates acceptance rate', () => {
    InsuranceService.applyClaimAdjudicationOutcome(
      { id: 'cl1', payer_id: 'BCBS_PILOT', service_code: '99213' },
      'paid'
    );
    InsuranceService.applyClaimAdjudicationOutcome(
      { id: 'cl2', payer_id: 'BCBS_PILOT', service_code: '99213' },
      'denied'
    );
    const conf = getHistoricalConfidence('BCBS_PILOT', '99213');
    expect(conf).toBe(0.5);
  });
});
