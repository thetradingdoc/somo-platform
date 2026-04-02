'use strict';

// Keep behavior aligned with `unified-dashboard/patients/checkout-phone-e164.js` (manual sync; same vectors).
const { normalizeToE164, isLikelyE164 } = require('../utils/phone-e164');

describe('normalizeToE164', () => {
  test('US 10-digit local → +1', () => {
    expect(normalizeToE164('5551234567')).toBe('+15551234567');
    expect(normalizeToE164('(555) 123-4567')).toBe('+15551234567');
  });

  test('leading 1 without plus → +1…', () => {
    expect(normalizeToE164('15551234567')).toBe('+15551234567');
    expect(normalizeToE164('1 555 123 4567')).toBe('+15551234567');
  });

  test('explicit +1', () => {
    expect(normalizeToE164('+1 555 123 4567')).toBe('+15551234567');
  });

  test('international digits preserved with +', () => {
    expect(normalizeToE164('+44 20 7946 0958')).toBe('+442079460958');
  });

  test('reject too short or too long digit strings', () => {
    expect(normalizeToE164('1234567')).toBe('');
    expect(normalizeToE164('1' + '2'.repeat(20))).toBe('');
  });

  test('isLikelyE164', () => {
    expect(isLikelyE164('+15551234567')).toBe(true);
    expect(isLikelyE164('15551234567')).toBe(false);
  });
});
