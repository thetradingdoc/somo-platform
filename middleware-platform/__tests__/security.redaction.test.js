'use strict';

const { redactText, redactObject } = require('../services/redaction-service');
const { assertTokenizedOnlyPaymentInput } = require('../utils/payment-input-policy');

describe('privacy redaction controls', () => {
  test('redacts PAN/CVV/secret-like fields in text', () => {
    const raw = 'card 4242 4242 4242 4242 cvv:123 client_secret=pi_abc_secret_123456';
    const out = redactText(raw);
    expect(out).not.toMatch(/4242 4242 4242 4242/);
    expect(out).not.toMatch(/cvv:123/i);
    expect(out).not.toMatch(/secret_123456/);
  });

  test('redacts nested object sensitive keys', () => {
    const out = redactObject({
      email: 'user@example.com',
      payment_token: 'tok_xxx',
      nested: { card_number: '4242424242424242', cvc: '123' }
    });
    expect(out.email).toBe('[REDACTED]');
    expect(out.payment_token).toBe('[REDACTED]');
    expect(out.nested.card_number).toBe('[REDACTED]');
    expect(out.nested.cvc).toBe('[REDACTED]');
  });

  test('tokenized-only payment input policy rejects raw card data', () => {
    const blocked = assertTokenizedOnlyPaymentInput({ card_number: '4242424242424242', cvv: '123' });
    expect(blocked.ok).toBe(false);
    const allowed = assertTokenizedOnlyPaymentInput({ payment_intent_id: 'pi_123', provider_id: 'merchant_x' });
    expect(allowed.ok).toBe(true);
  });
});
