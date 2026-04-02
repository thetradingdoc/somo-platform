/**
 * Browser copy of middleware-platform/utils/phone-e164.js — keep logic in sync.
 * Loaded before checkout-chat.js. Exposes window.normalizeToE164Checkout / window.isLikelyE164Checkout.
 */
(function (global) {
  'use strict';

  function normalizeToE164(input) {
    if (input == null) return '';
    const raw = String(input).trim();
    if (!raw) return '';
    const digits = raw.replace(/\D/g, '');
    if (!digits) return '';
    if (digits.length < 8 || digits.length > 15) return '';
    if (digits.length === 10) return '+1' + digits;
    if (digits.length === 11 && digits[0] === '1') return '+' + digits;
    return '+' + digits;
  }

  function isLikelyE164(s) {
    return /^\+[1-9]\d{7,14}$/.test(String(s || '').trim());
  }

  global.normalizeToE164Checkout = normalizeToE164;
  global.isLikelyE164Checkout = isLikelyE164;
})(typeof window !== 'undefined' ? window : globalThis);
