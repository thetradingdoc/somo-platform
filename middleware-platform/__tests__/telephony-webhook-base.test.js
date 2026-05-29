'use strict';

const axios = require('axios');

jest.mock('axios');

const { isLocalhostBase, resolveTelephonyWebhookBase } = require('../utils/telephony-webhook-base');

describe('telephony-webhook-base', () => {
  const orig = { ...process.env };

  afterEach(() => {
    process.env = { ...orig };
    jest.resetAllMocks();
  });

  test('isLocalhostBase detects localhost', () => {
    expect(isLocalhostBase('http://localhost:4000')).toBe(true);
    expect(isLocalhostBase('https://api.example.com')).toBe(false);
  });

  test('resolveTelephonyWebhookBase uses TWILIO_OUTBOUND_WEBHOOK_URL', async () => {
    process.env.API_BASE_URL = 'http://localhost:4000';
    process.env.TWILIO_OUTBOUND_WEBHOOK_URL = 'https://abc.ngrok-free.app';
    const base = await resolveTelephonyWebhookBase();
    expect(base).toBe('https://abc.ngrok-free.app');
  });

  test('resolveTelephonyWebhookBase throws friendly error on localhost only', async () => {
    process.env.API_BASE_URL = 'http://localhost:4000';
    delete process.env.TWILIO_OUTBOUND_WEBHOOK_URL;
    delete process.env.NGROK_URL;
    delete process.env.PUBLIC_API_BASE_URL;
    axios.get.mockRejectedValue(new Error('no ngrok'));
    await expect(resolveTelephonyWebhookBase()).rejects.toThrow(/public webhook URL/i);
  });
});
