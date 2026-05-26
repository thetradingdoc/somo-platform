'use strict';

const InsuranceService = require('../services/insurance-service');

describe('InsuranceService claim envelope', () => {
  test('_buildClaimRequest includes POS, modifiers, and taxonomy', () => {
    const req = InsuranceService._buildClaimRequest({
      patientId: 'p1',
      memberId: 'm1',
      payerId: 'BCBS',
      serviceCode: '99213',
      diagnosisCode: 'R07.9',
      placeOfService: '02',
      modifiers: ['95'],
      taxonomyCode: '207Q00000X',
      npi: '1234567890',
      dateOfService: '2025-01-15',
      totalAmount: 150,
      copayPaid: 20
    });
    expect(req.service.placeOfServiceCode).toBe('02');
    expect(req.service.procedureModifiers).toEqual(['95']);
    expect(req.provider.taxonomyCode).toBe('207Q00000X');
  });
});
