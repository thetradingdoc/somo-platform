'use strict';

const PaymentFlowService = require('../services/payment-flow-service');

describe('PaymentFlowService amount SSOT', () => {
  test('delegates resolveAmountDue', async () => {
    const r = await PaymentFlowService.resolveAmountDue({});
    expect(r).toHaveProperty('status');
    expect(r).toHaveProperty('amount');
  });

  test('delegates resolveCheckoutAmount', async () => {
    const r = await PaymentFlowService.resolveCheckoutAmount({ requireHardNumber: true });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('quote_required');
  });

  test('logAmountResolution is callable', () => {
    expect(() => PaymentFlowService.logAmountResolution({})).not.toThrow();
  });
});
