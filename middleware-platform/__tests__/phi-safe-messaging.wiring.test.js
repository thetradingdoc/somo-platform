'use strict';

const SMSService = require('../services/sms-service');
const EmailService = require('../services/email-service');

describe('PHI-safe messaging wiring (Phase 0.3)', () => {
  test('SMS sendSMS blocks clinical diagnosis patterns before Twilio', async () => {
    const result = await SMSService.sendSMS(
      '+15551234567',
      'Patient John has diagnosis: eczema'
    );
    expect(result.success).toBe(false);
    expect(result.code).toBe('PHI_SAFE_MESSAGE_BLOCKED');
  });

  test('EmailService.sendEmail blocks clinical patterns', async () => {
    const result = await EmailService.sendEmail({
      to: 'test@example.com',
      subject: 'Results',
      text: 'Lab result: glucose 240 mg/dL'
    });
    expect(result.success).toBe(false);
    expect(result.error_code).toBe('PHI_SAFE_MESSAGE_BLOCKED');
  });

  test('benign payment SMS passes validation', async () => {
    const result = await SMSService.sendSMS(
      '+15555555555',
      'Your clinic: Pay securely: https://callsomo.com/pay/abc'
    );
    expect(result.success).toBe(true);
  });
});
