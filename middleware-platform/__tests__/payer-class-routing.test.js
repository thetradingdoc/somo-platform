'use strict';

const { classifyPayerContext } = require('../services/payer-class-routing');
const { resolveAmountDue } = require('../services/resolve-amount-due');

jest.mock('../database', () => ({
  db: { prepare: () => ({ get: () => null }) }
}));

jest.mock('../services/payer-quote-service', () => ({
  computeVisitQuote: jest.fn(async () => ({
    status: 'hard_number',
    copay_due_now: 0,
    source: 'plan_rules'
  }))
}));

describe('C-PR medical vs dental payer routing', () => {
  test('blocks medical payer on dental tenant', () => {
    const r = classifyPayerContext({
      payerId: 'BCBS_PILOT',
      planId: 'plan_x',
      tenantSpecialty: 'Dental'
    });
    expect(r.ok).toBe(false);
    expect(r.error_code).toBe('PAYER_CLASS_MISMATCH');
  });

  test('allows dental payer on dental tenant', () => {
    const r = classifyPayerContext({
      payerId: 'DELTA_DENTAL_NY',
      planId: 'dental_ppo',
      tenantSpecialty: 'Dental'
    });
    expect(r.ok).toBe(true);
  });

  test('resolveAmountDue defers provider/location quotes', async () => {
    const r = await resolveAmountDue({
      patientId: 'p1',
      payerId: 'DELTA_DENTAL_NY',
      serviceCode: 'D1110',
      providerId: 'dr_smith'
    });
    expect(r.status).toBe('defer');
    expect(r.notes).toBe('provider_location_out_of_scope');
  });
});
