'use strict';

const {
  getHipaaProductionViolations,
  getKellyRoutingViolations,
  getAllEnvGateViolations
} = require('../services/hipaa-production-guards');

describe('hipaa-production-guards', () => {
  test('production profile requires BAA and FHIR JWT', () => {
    const violations = getHipaaProductionViolations({ CLOUDRUN_PROFILE: 'production' });
    expect(violations.some((v) => v.includes('BAA_ACKNOWLEDGED'))).toBe(true);
    expect(violations.some((v) => v.includes('REQUIRE_JWT_FOR_FHIR'))).toBe(true);
    expect(violations.some((v) => v.includes('RETELL_API_KEY'))).toBe(true);
  });

  test('production profile passes when HIPAA env vars set', () => {
    const violations = getHipaaProductionViolations({
      CLOUDRUN_PROFILE: 'production',
      BAA_ACKNOWLEDGED: '1',
      REQUIRE_JWT_FOR_FHIR: '1',
      RETELL_API_KEY: 'key',
      TWILIO_ACCOUNT_SID: 'sid',
      TWILIO_AUTH_TOKEN: 'token',
      STRIPE_SECRET_KEY: 'sk_test',
      ADMIN_PORTAL_SECRET: 'admin-secret'
    });
    expect(violations).toEqual([]);
  });

  test('production profile requires ADMIN_PORTAL_SECRET', () => {
    const violations = getHipaaProductionViolations({
      CLOUDRUN_PROFILE: 'production',
      BAA_ACKNOWLEDGED: '1',
      REQUIRE_JWT_FOR_FHIR: '1',
      RETELL_API_KEY: 'key',
      TWILIO_ACCOUNT_SID: 'sid',
      TWILIO_AUTH_TOKEN: 'token',
      STRIPE_SECRET_KEY: 'sk_test'
    });
    expect(violations.some((v) => v.includes('ADMIN_PORTAL_SECRET'))).toBe(true);
  });

  test('shadow routing blocked in production', () => {
    const violations = getKellyRoutingViolations({
      CLOUDRUN_PROFILE: 'production',
      CONVERSATION_MODE_ROUTING: 'shadow'
    });
    expect(violations.length).toBeGreaterThan(0);
  });

  test('getAllEnvGateViolations merges checks', () => {
    const violations = getAllEnvGateViolations({
      CLOUDRUN_PROFILE: 'staging',
      ALLOW_DEV_CLINIC_FALLBACK: '1'
    });
    expect(violations.some((v) => v.includes('ALLOW_DEV_CLINIC_FALLBACK'))).toBe(true);
  });
});
