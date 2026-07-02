'use strict';

const { buildPpoReadback } = require('../services/ppo-readback-service');
const { assessPayerReadiness, getTopDentalPayers } = require('../services/payer-preflight-service');

describe('ppo-readback-service', () => {
  test('builds copay and deductible readback', () => {
    const line = buildPpoReadback({
      planSummary: 'Delta PPO',
      copay: 25,
      deductibleRemaining: 200,
      deductibleTotal: 500,
      eligible: true
    });
    expect(line).toContain('Delta PPO');
    expect(line).toContain('copay $25');
    expect(line).toContain('deductible');
  });

  test('thin eligibility fallback message', () => {
    const line = buildPpoReadback({ eligible: true, eligibility_quality: 'thin' });
    expect(line).toContain('limited');
  });
});

describe('payer-preflight-service', () => {
  test('returns top 5 NYC dental payers', () => {
    const payers = getTopDentalPayers(5);
    expect(payers).toHaveLength(5);
    expect(payers[0].id).toBe('DELTA_DENTAL_NY');
  });

  test('assessPayerReadiness marks untested payers', () => {
    const rows = assessPayerReadiness({ db: null }, { clinicId: 'c1' });
    expect(rows.length).toBeGreaterThanOrEqual(5);
    expect(rows.every((r) => r.status === 'untested')).toBe(true);
  });
});
