'use strict';

const InsuranceService = require('../../services/insurance-service');

describe('InsuranceService payer mapping', () => {
  const orig = { ...process.env };

  afterEach(() => {
    process.env = { ...orig };
  });

  test('maps demo UHC alias to test payer in test mode', () => {
    process.env.STEDI_TEST_MODE = '1';
    process.env.STEDI_TEST_PAYER_ID = 'STEDI';
    expect(InsuranceService.resolveTradingPartnerServiceId('UHC')).toBe('STEDI');
  });

  test('passes numeric trading partner ids through', () => {
    expect(InsuranceService.resolveTradingPartnerServiceId('60054')).toBe('60054');
  });
});
