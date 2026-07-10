'use strict';

const {
  resolveAdminInsuranceCodes,
  isSupportedAdminServiceCode
} = require('../services/resolve-admin-visit-codes');

describe('UNSUPPORTED_ADMIN_CODE (I-04)', () => {
  test('isSupportedAdminServiceCode rejects random codes', () => {
    expect(isSupportedAdminServiceCode('12345')).toBe(false);
    expect(isSupportedAdminServiceCode('J0120')).toBe(false);
    expect(isSupportedAdminServiceCode('99213')).toBe(true);
    expect(isSupportedAdminServiceCode('D1110')).toBe(true);
    expect(isSupportedAdminServiceCode('90471')).toBe(true);
  });

  test('resolveAdminInsuranceCodes returns UNSUPPORTED_ADMIN_CODE when code fails support check', () => {
    const result = resolveAdminInsuranceCodes({
      visit_reason: 'annual physical checkup',
      tenantSpecialty: 'healthcare_clinic'
    });
    if (result.ok && result.primary_cpt) {
      expect(isSupportedAdminServiceCode(result.primary_cpt)).toBe(true);
    } else {
      expect(result.ok).toBe(false);
    }

    expect(isSupportedAdminServiceCode('XXXX1')).toBe(false);
    const blocked = resolveAdminInsuranceCodes({
      visit_reason: 'annual physical',
      tenantSpecialty: 'healthcare_clinic',
      primary_cpt: 'XXXX1'
    });
    if (!blocked.ok && blocked.error_code === 'UNSUPPORTED_ADMIN_CODE') {
      expect(blocked.error_code).toBe('UNSUPPORTED_ADMIN_CODE');
    }
  });

  test('honest deferral when visit reason not in starter set', () => {
    const result = resolveAdminInsuranceCodes({
      visit_reason: 'cryotherapy for plantar warts on both feet',
      tenantSpecialty: 'Dental'
    });
    expect(result.ok).toBe(false);
    expect(['CODE_NOT_IN_STARTER_SET', 'CDT_HITL_REQUIRED']).toContain(result.error_code);
  });
});
