'use strict';

const InsuranceService = require('../services/insurance-service');

describe('InsuranceService Stedi Healthcare v3', () => {
  const orig = { ...process.env };

  afterEach(() => {
    process.env = { ...orig };
    InsuranceService.STEDI_API_KEY = orig.STEDI_API_KEY || 'test_1rRzTb0.Va9Tn88BB3fgPgttprqbrxQ1';
  });

  test('isStediTestMode when STEDI_TEST_MODE=1', () => {
    process.env.STEDI_TEST_MODE = '1';
    InsuranceService.STEDI_API_KEY = 'test_abc';
    expect(InsuranceService.isStediTestMode()).toBe(true);
    expect(InsuranceService.canCallStediHealthcare()).toBe(true);
  });

  test('canCallStediHealthcare false when test key and STEDI_TEST_MODE=0', () => {
    process.env.STEDI_TEST_MODE = '0';
    InsuranceService.STEDI_API_KEY = 'test_abc';
    expect(InsuranceService.canCallStediHealthcare()).toBe(false);
  });

  test('canCallStediHealthcare true for production-like key', () => {
    InsuranceService.STEDI_API_KEY = 'sk_live_abc';
    expect(InsuranceService.canCallStediHealthcare()).toBe(true);
  });

  test('_buildHealthcareEligibilityJson has Stedi v3 fields not json wrapper', () => {
    process.env.STEDI_TEST_PAYER_ID = 'STEDI';
    const body = InsuranceService._buildHealthcareEligibilityJson({
      patientName: 'Jane Doe',
      dateOfBirth: '1990-01-15',
      memberId: '0000000001',
      payerId: 'STEDI',
      serviceCode: '99213',
      dateOfService: '2026-05-26'
    });
    expect(body.json).toBeUndefined();
    expect(body.tradingPartnerServiceId).toBe('STEDI');
    expect(body.subscriber.memberId).toBe('0000000001');
    expect(body.subscriber.firstName).toBe('Jane');
    expect(body.subscriber.lastName).toBe('Doe');
    expect(body.subscriber.dateOfBirth).toBe('19900115');
    expect(body.encounter.serviceTypeCodes).toEqual(['30']);
    expect(body.provider.npi).toBeTruthy();
  });

  test('_eligibilityFromParsed271 includes priorAuthIndicator', () => {
    const out = InsuranceService._eligibilityFromParsed271({
      eligible: true,
      copay: 20,
      allowedAmount: 100,
      insurancePays: 80,
      priorAuthIndicator: 'Y',
      priorAuthNotes: ['Prior auth required']
    });
    expect(out.priorAuthIndicator).toBe('Y');
    expect(out.priorAuthNotes).toEqual(['Prior auth required']);
  });
});
