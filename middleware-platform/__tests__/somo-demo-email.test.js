'use strict';

const {
  isDeliverableDemoEmail,
  sendDemoConfirmation
} = require('../services/somo-demo-email');

describe('somo-demo-email', () => {
  test('blocks placeholder and test local-parts', () => {
    expect(isDeliverableDemoEmail('test@callsomo.com')).toBe(false);
    expect(isDeliverableDemoEmail('testing@callsomo.com')).toBe(false);
    expect(isDeliverableDemoEmail('fake@gmail.com')).toBe(false);
    expect(isDeliverableDemoEmail('user@example.com')).toBe(false);
    expect(isDeliverableDemoEmail('')).toBe(false);
    expect(isDeliverableDemoEmail(null)).toBe(false);
  });

  test('allows real-looking addresses', () => {
    expect(isDeliverableDemoEmail('richard@callsomo.com')).toBe(true);
    expect(isDeliverableDemoEmail('owner@clinic.org')).toBe(true);
  });

  test('sendDemoConfirmation skips undeliverable addresses', async () => {
    const result = await sendDemoConfirmation('test@callsomo.com', { prospectName: 'Terminal Test' });
    expect(result).toMatchObject({ skipped: true, reason: 'undeliverable_email' });
  });
});
