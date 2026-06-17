'use strict';

const {
  evaluateIdentityAdmission,
  handoffCopy
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
      call_type: 'inbound_tenant',
      direction: 'inbound',
      clinicId: 'clinic-1',
      tenantResolved: true
    });
    expect(out.admitted).toBe(true);
  });

  test('handoff copy available in es', () => {
    expect(handoffCopy('es')).toMatch(/clínica/i);
  });
});
