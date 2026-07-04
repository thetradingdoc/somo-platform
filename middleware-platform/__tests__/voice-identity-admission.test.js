'use strict';

const {
  evaluateIdentityAdmission,
  handoffCopy,
  isTenantIdentityResolved
} = require('../services/voice-identity-admission');

describe('voice identity admission', () => {
  test('rejects inbound tenant without clinic or customer id', () => {
    const out = evaluateIdentityAdmission({
      call_type: 'inbound_tenant',
      direction: 'inbound',
      tenantResolved: false
    });
    expect(out.admitted).toBe(false);
    expect(out.reason).toBe('tenant_identity_unresolved');
    expect(out.reply).toBeTruthy();
  });

  test('admits inbound when clinic id present', () => {
    const out = evaluateIdentityAdmission({
      call_type: 'tenant',
      direction: 'inbound',
      clinicId: 'clinic-1',
      db: {
        getCustomerIdForClinic: () => 'cust-1',
        getClinic: () => ({ clinic_id: 'clinic-1' })
      }
    });
    expect(out.admitted).toBe(true);
  });

  test('admits inbound when clinic row exists without customer mapping', () => {
    const out = evaluateIdentityAdmission({
      call_type: 'tenant',
      direction: 'inbound',
      clinicId: 'clinic-orphan',
      db: {
        getCustomerIdForClinic: () => null,
        getClinic: (id) => (id === 'clinic-orphan' ? { clinic_id: id } : null)
      }
    });
    expect(out.admitted).toBe(true);
  });

  test('isTenantIdentityResolved with customer id', () => {
    expect(isTenantIdentityResolved({ customerId: 'cust-1' })).toBe(true);
  });

  test('handoff copy available in es', () => {
    expect(handoffCopy('es')).toMatch(/clínica/i);
  });
});
