'use strict';

const { resolveInsuranceCodes } = require('../services/resolve-insurance-codes');
const { TriagePolicy } = require('../services/conversation-mode/tenant-policy');

describe('resolve-insurance-codes admin path', () => {
  test('uses admin resolver when triage_policy disabled', () => {
    const r = resolveInsuranceCodes('sess_test', {
      triage_policy: TriagePolicy.DISABLED,
      visit_reason: 'cleaning',
      tenantSpecialty: 'Dental'
    });
    expect(r.ok).toBe(true);
    expect(r.primary_cpt).toBe('D1110');
    expect(r.admin_path).toBe(true);
  });
});
