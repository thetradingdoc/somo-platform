'use strict';

const { redactText, redactObject, redactToolEvent } = require('../services/redaction-service');

describe('security redaction service', () => {
  test('redactText masks email, card, cvv, and token values', () => {
    const input =
      'email me@site.com card 4242 4242 4242 4242 cvv:123 payment_token=tok_live_12345';
    const out = redactText(input);
    expect(out).toContain('[REDACTED_EMAIL]');
    expect(out).toContain('[REDACTED_CARD]');
    expect(out).toContain('cvv:[REDACTED]');
    expect(out).toContain('payment_token:[REDACTED]');
  });

  test('redactObject masks sensitive keys recursively', () => {
    const input = {
      profile: {
        email: 'user@site.com',
        nested: { client_secret: 'abc123', notes: 'ok' }
      },
      phone: '5551231234'
    };
    const out = redactObject(input);
    expect(out.profile.email).toBe('[REDACTED]');
    expect(out.profile.nested.client_secret).toBe('[REDACTED]');
    expect(out.phone).toBe('[REDACTED]');
    expect(out.profile.nested.notes).toBe('ok');
  });

  test('redactToolEvent strips raw metadata payloads', () => {
    const evt = {
      metadata: {
        raw_args: '{"card":"4242"}',
        raw_result: 'token=abc',
        prompt: 'sensitive',
        response: 'sensitive'
      }
    };
    const out = redactToolEvent(evt);
    expect(out.metadata.raw_args).toBe('[REDACTED]');
    expect(out.metadata.raw_result).toBe('[REDACTED]');
    expect(out.metadata.prompt).toBe('[REDACTED]');
    expect(out.metadata.response).toBe('[REDACTED]');
  });
});
