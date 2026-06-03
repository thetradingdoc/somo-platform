'use strict';

const { canViewClinicalPhi } = require('../lib/clinical-phi-access');

describe('clinical-phi-access', () => {
  test('denies anonymous request', () => {
    expect(canViewClinicalPhi({})).toBe(false);
  });

  test('allows provider id header', () => {
    expect(canViewClinicalPhi({ headers: { 'x-provider-id': 'prov-1' } })).toBe(true);
  });

  test('allows staff scope', () => {
    expect(canViewClinicalPhi({ user: { scope: 'clinician' } })).toBe(true);
  });

  test('allows admin role', () => {
    expect(canViewClinicalPhi({ user: { role: 'admin' } })).toBe(true);
  });
});
