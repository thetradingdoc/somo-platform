'use strict';

const axios = require('axios');

jest.mock('axios', () => {
  const mock = {
    create: jest.fn(),
    post: jest.fn(),
    get: jest.fn()
  };
  mock.create.mockReturnValue(mock);
  return mock;
});

jest.mock('../database', () => ({
  getClaimById: jest.fn(),
  getAppointment: jest.fn(),
  getPriorAuthRequestsByAppointment: jest.fn(() => []),
  getFHIRPatient: jest.fn(),
  getEligibilityChecksByPatient: jest.fn(() => []),
  createEligibilityCheck: jest.fn(),
  updateInsuranceClaim: jest.fn()
}));

const db = require('../database');
const InsuranceService = require('../services/insurance-service');

describe('InsuranceService.submitExistingClaim', () => {
  const origKey = process.env.STEDI_API_KEY;
  let checkEligibilitySpy = null;

  beforeEach(() => {
    jest.clearAllMocks();
    checkEligibilitySpy = null;
    db.getPriorAuthRequestsByAppointment.mockReturnValue([]);
    db.getClaimById.mockReturnValue({
      id: 'claim_test_1',
      appointment_id: 'appt_1',
      patient_id: 'pat_1',
      member_id: 'M123',
      payer_id: '60054',
      service_code: '99213',
      diagnosis_code: 'Z00.00',
      total_amount: 150,
      copay_amount: 20,
      status: 'draft',
      response_data: '{}'
    });
    db.getAppointment.mockReturnValue({ requires_prior_auth: false });
    db.getFHIRPatient.mockReturnValue({
      name: 'Test Patient',
      birth_date: '1990-01-01',
      resource_data: {
        name: [{ given: ['Test'], family: 'Patient' }],
        birthDate: '1990-01-01'
      }
    });

    InsuranceService.STEDI_API_KEY = 'sk_live_test_key_for_jest';
    process.env.STEDI_API_KEY = 'sk_live_test_key_for_jest';

    const client = axios.create();
    client.post.mockImplementation((url) => {
      if (String(url).includes('837-to-edi')) {
        return Promise.resolve({ data: { edi: 'ISA*MOCK837*' } });
      }
      if (String(url).includes('raw-x12-submission')) {
        return Promise.resolve({ data: { claimId: 'stedi_claim_abc' } });
      }
      return Promise.resolve({ data: {} });
    });
    axios.create.mockReturnValue(client);
  });

  afterEach(() => {
    if (origKey === undefined) delete process.env.STEDI_API_KEY;
    else process.env.STEDI_API_KEY = origKey;
    InsuranceService.STEDI_API_KEY = origKey || 'test_1rRzTb0.Va9Tn88BB3fgPgttprqbrxQ1';
    if (checkEligibilitySpy) checkEligibilitySpy.mockRestore();
  });

  test('persists x12_claim_id and healthcareSubmitted when Stedi accepts', async () => {
    checkEligibilitySpy = jest
      .spyOn(InsuranceService, 'checkEligibility')
      .mockResolvedValue({ eligible: true });

    const result = await InsuranceService.submitExistingClaim('claim_test_1');
    expect(result.success).toBe(true);
    expect(result.x12ClaimId).toBe('stedi_claim_abc');
    expect(result.healthcareSubmitted).toBe(true);
    expect(checkEligibilitySpy).toHaveBeenCalledWith(expect.objectContaining({
      patientName: 'Test Patient',
      dateOfBirth: '1990-01-01',
      memberId: 'M123',
      payerId: '60054',
      serviceCode: '99213'
    }));
    expect(db.updateInsuranceClaim).toHaveBeenCalledWith(
      'claim_test_1',
      expect.objectContaining({
        x12_claim_id: 'stedi_claim_abc',
        status: 'submitted'
      })
    );
  });

  test('blocks submit when PA required but not approved', async () => {
    db.getAppointment.mockReturnValue({ requires_prior_auth: true });
    db.getPriorAuthRequestsByAppointment.mockReturnValue([]);
    await expect(InsuranceService.submitExistingClaim('claim_test_1')).rejects.toMatchObject({
      code: 'PRIOR_AUTH_REQUIRED'
    });
  });

  test('idempotent no-op when claim already submitted', async () => {
    db.getClaimById.mockReturnValue({
      id: 'claim_test_1',
      appointment_id: 'appt_1',
      patient_id: 'pat_1',
      member_id: 'M123',
      payer_id: '60054',
      service_code: '99213',
      diagnosis_code: 'Z00.00',
      total_amount: 150,
      copay_amount: 20,
      status: 'submitted',
      x12_claim_id: 'stedi_claim_abc',
      response_data: JSON.stringify({
        stedi_translate_ok: true,
        healthcare_submitted: true,
        prior_authorization_number: 'PA_123'
      })
    });

    axios.create.mockClear();
    db.updateInsuranceClaim.mockClear();

    checkEligibilitySpy = jest
      .spyOn(InsuranceService, 'checkEligibility')
      .mockResolvedValue({ eligible: true });

    const result = await InsuranceService.submitExistingClaim('claim_test_1');
    expect(result.success).toBe(true);
    expect(result.idempotent).toBe(true);
    expect(result.x12ClaimId).toBe('stedi_claim_abc');
    expect(db.updateInsuranceClaim).not.toHaveBeenCalled();
    expect(checkEligibilitySpy).not.toHaveBeenCalled();
    expect(axios.create).not.toHaveBeenCalled();
  });
});
