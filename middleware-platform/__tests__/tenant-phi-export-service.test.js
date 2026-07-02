'use strict';

const { maskPhone, maskEmail, redactPatient, redactEligibility } = require('../services/tenant-phi-export-service');

describe('tenant-phi-export-service', () => {
  test('maskPhone keeps last 4', () => {
    expect(maskPhone('8085551234')).toBe('***-***-1234');
  });

  test('maskEmail redacts local part', () => {
    expect(maskEmail('user@example.com')).toMatch(/@example\.com$/);
  });

  test('redactPatient omits raw phone', () => {
    const row = redactPatient({
      resource_id: 'p1',
      name: 'Jane',
      phone: '8085551234',
      email: 'j@x.com'
    });
    expect(row.phone_masked).toBe('***-***-1234');
    expect(row.phone).toBeUndefined();
  });

  test('redactEligibility omits response_data', () => {
    const row = redactEligibility({
      id: 'e1',
      patient_id: 'p1',
      payer_id: 'BCBS',
      eligible: 1,
      response_data: '{"secret":true}'
    });
    expect(row.response_data).toBeUndefined();
    expect(row.payer_id).toBe('BCBS');
  });
});
