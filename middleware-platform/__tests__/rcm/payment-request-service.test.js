'use strict';

const paymentRequest = require('../../services/rcm-payment-request-service');

describe('rcm-payment-request-service', () => {
  test('payUrlFromToken builds patients pay path', () => {
    const url = paymentRequest.payUrlFromToken('http://localhost:4000', 'abc123');
    expect(url).toBe('http://localhost:4000/patients/pay.html?token=abc123');
  });

  test('resolveCopayAmount prefers explicit amount', () => {
    expect(paymentRequest.resolveCopayAmount({ amount: 25 })).toBe(25);
  });

  test('createRcmPaymentRequest rejects missing clinic', () => {
    const result = paymentRequest.createRcmPaymentRequest({ clinicId: '', amount: 10 });
    expect(result.success).toBe(false);
  });
});
