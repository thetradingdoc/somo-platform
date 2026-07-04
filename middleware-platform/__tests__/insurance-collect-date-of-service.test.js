'use strict';

jest.mock('../services/insurance-service', () => ({
  checkEligibility: jest.fn().mockResolvedValue({ success: true, copay: 25 }),
  _resolveSimulatePayerKey: jest.fn().mockReturnValue('aetna')
}));

jest.mock('../services/resolve-amount-due', () => ({
  resolveAmountDue: jest.fn().mockResolvedValue({ status: 'hard_number', amount: 25 })
}));

jest.mock('../services/journey-gates-service', () => ({
  checkQuoteGate: jest.fn().mockReturnValue({ allowed: true })
}));

const InsuranceService = require('../services/insurance-service');
const { postDirect } = require('../services/kelly-tool-executor/http-client');

describe('insurance collect dateOfService (M1b)', () => {
  test('postDirect /insurance/collect defaults dateOfService to today', async () => {
    const today = new Date().toISOString().split('T')[0];
    await postDirect('/insurance/collect', {
      payer_name: 'aetna',
      date_of_birth: '1990-01-15',
      session_id: 'sess-dos'
    });
    expect(InsuranceService.checkEligibility).toHaveBeenCalledWith(
      expect.objectContaining({ dateOfService: today })
    );
  });
});
