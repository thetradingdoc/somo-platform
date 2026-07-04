'use strict';

const InsuranceService = require('../services/insurance-service');

describe('insurance simulate payer normalization', () => {
  const phrases = [
    { payer_name: 'I have Aetna.', expectCopay: 25 },
    { payer_name: 'Aetna insurance', expectCopay: 25 },
    { payer_name: 'my carrier is Aetna', expectCopay: 25 },
    { payer_name: 'Tengo Aetna', expectCopay: 25 },
    { payer_name: 'Delta Dental', expectCopay: 20 }
  ];

  beforeAll(() => {
    process.env.VOICE_ELIGIBILITY_SIMULATE = '1';
  });

  test.each(phrases)('phrase "$payer_name" maps to non-zero mock copay', async ({ payer_name, expectCopay }) => {
    const result = await InsuranceService._mockEligibilityTable({ payer_name });
    expect(result.copay).toBe(expectCopay);
    expect(result.copay).toBeGreaterThan(0);
  });

  test('_simulateEligibilityCheck skips Stedi when VOICE_ELIGIBILITY_SIMULATE=1', async () => {
    const result = await InsuranceService._simulateEligibilityCheck({ payer_name: 'aetna' });
    expect(result.copay).toBe(25);
  });
});
