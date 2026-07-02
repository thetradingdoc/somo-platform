'use strict';

const {
  validateHealthcareVoiceVars,
  isHealthcareVoiceTenant
} = require('../services/voice-dynamic-vars');

describe('voice-dynamic-vars', () => {
  test('healthcare tenant requires customer_id, clinic_id, call_type', () => {
    const customer = { use_case: 'dental', billing_vertical: 'healthcare' };
    expect(isHealthcareVoiceTenant(customer)).toBe(true);
    const bad = validateHealthcareVoiceVars({
      customer,
      customerId: 'c1',
      clinicId: null,
      callType: null
    });
    expect(bad.ok).toBe(false);
    expect(bad.missing).toEqual(expect.arrayContaining(['clinic_id', 'call_type']));
  });

  test('non-healthcare tenant passes without vars', () => {
    const ok = validateHealthcareVoiceVars({
      customer: { use_case: 'small_business' },
      customerId: null,
      clinicId: null,
      callType: null
    });
    expect(ok.ok).toBe(true);
  });
});
