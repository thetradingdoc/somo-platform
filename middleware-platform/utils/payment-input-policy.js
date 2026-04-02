'use strict';

const FORBIDDEN_PAYMENT_KEYS = new Set([
  'card_number',
  'pan',
  'cvc',
  'cvv',
  'security_code',
  'expiry',
  'exp_month',
  'exp_year'
]);

function hasForbiddenPaymentKeys(body) {
  if (!body || typeof body !== 'object') return false;
  return Object.keys(body).some((k) => FORBIDDEN_PAYMENT_KEYS.has(String(k || '').toLowerCase()));
}

function hasCardLikeValue(body) {
  const cardPattern = /\b(?:\d[ -]?){13,19}\b/;
  const cvvPattern = /\b(?:cvv|cvc|security[\s_-]?code)\s*[:=]?\s*\d{3,4}\b/i;
  const stack = [body];
  while (stack.length > 0) {
    const cur = stack.pop();
    if (cur == null) continue;
    if (typeof cur === 'string') {
      if (cvvPattern.test(cur)) return true;
      if (cardPattern.test(cur)) return true;
      continue;
    }
    if (Array.isArray(cur)) {
      for (const v of cur) stack.push(v);
      continue;
    }
    if (typeof cur === 'object') {
      for (const [k, v] of Object.entries(cur)) {
        if (FORBIDDEN_PAYMENT_KEYS.has(String(k || '').toLowerCase())) return true;
        stack.push(v);
      }
    }
  }
  return false;
}

function assertTokenizedOnlyPaymentInput(body) {
  if (hasForbiddenPaymentKeys(body) || hasCardLikeValue(body)) {
    return {
      ok: false,
      error: 'raw_card_data_forbidden',
      message: 'Raw card data is not accepted. Use Stripe Elements tokenized payment flow only.'
    };
  }
  return { ok: true };
}

module.exports = {
  assertTokenizedOnlyPaymentInput
};
