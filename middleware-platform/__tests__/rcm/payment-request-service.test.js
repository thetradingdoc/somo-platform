'use strict';

describe('rcm-payment-request-service', () => {
  const paymentRequest = require('../../services/rcm-payment-request-service');

  test('payUrlFromToken builds patients pay path', () => {
    const url = paymentRequest.payUrlFromToken('http://localhost:4000', 'abc123');
    expect(url).toBe('http://localhost:4000/patients/pay.html?token=abc123');
  });

  test('resolveCopayAmount prefers explicit amount', async () => {
    await expect(paymentRequest.resolveCopayAmount({ amount: 25 })).resolves.toBe(25);
  });

  test('createRcmPaymentRequest rejects missing clinic', async () => {
    const result = await paymentRequest.createRcmPaymentRequest({ clinicId: '', amount: 10 });
    expect(result.success).toBe(false);
  });
});
