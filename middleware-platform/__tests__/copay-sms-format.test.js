'use strict';

const SMSService = require('../services/sms-service');

describe('copay SMS format (H5)', () => {
  const link = 'https://pay.example.com/tok';

  test('EN template has copay copy, no undefined, no commerce phrase', () => {
    const body = SMSService.formatCopayPaymentSms({
      locale: 'en',
      clinicName: 'Somo Dental',
      amount: 25,
      paymentLink: link
    });
    expect(body).toContain('Somo Dental');
    expect(body).toContain('$25.00');
    expect(body).toMatch(/copay|pay securely/i);
    expect(body).not.toMatch(/undefined/i);
    expect(body).not.toMatch(/complete your order/i);
  });

  test('ES template is localized', () => {
    const body = SMSService.formatCopayPaymentSms({
      locale: 'es',
      clinicName: 'Clínica Somo',
      amount: 20,
      paymentLink: link
    });
    expect(body).toMatch(/copago|pague/i);
    expect(body).not.toMatch(/complete your order/i);
    expect(body).not.toMatch(/undefined/i);
  });

  test('RU template is localized', () => {
    const body = SMSService.formatCopayPaymentSms({
      locale: 'ru',
      clinicName: 'Somo',
      amount: 30,
      paymentLink: link
    });
    expect(body).toMatch(/копай|оплат/i);
    expect(body).not.toMatch(/undefined/i);
  });

  test('falls back clinic name when missing', () => {
    const body = SMSService.formatCopayPaymentSms({
      locale: 'en',
      amount: 15,
      paymentLink: link
    });
    expect(body).not.toMatch(/undefined/i);
    expect(body).toContain('Your clinic');
  });
});
