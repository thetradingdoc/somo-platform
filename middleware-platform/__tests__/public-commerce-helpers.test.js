'use strict';

/** Avoid loading full `database.js` (migrations) when only testing pure helpers. */
jest.mock('../database', () => ({}));

const {
  parseCheckoutSessionData,
  isQuoteExpired
} = require('../utils/public-commerce-helpers');

describe('public-commerce-helpers', () => {
  describe('parseCheckoutSessionData', () => {
    it('returns null for null/empty', () => {
      expect(parseCheckoutSessionData(null)).toBeNull();
      expect(parseCheckoutSessionData('')).toBeNull();
    });
    it('parses JSON string', () => {
      expect(parseCheckoutSessionData('{"x":1}')).toEqual({ x: 1 });
    });
    it('returns object as-is', () => {
      expect(parseCheckoutSessionData({ a: 2 })).toEqual({ a: 2 });
    });
    it('returns null on invalid JSON', () => {
      expect(parseCheckoutSessionData('not json')).toBeNull();
    });
  });

  describe('isQuoteExpired', () => {
    it('returns false when expires_at missing', () => {
      expect(isQuoteExpired({})).toBe(false);
      expect(isQuoteExpired({ expires_at: null })).toBe(false);
    });
    it('returns false for future expiry', () => {
      const future = new Date(Date.now() + 3600_000).toISOString();
      expect(isQuoteExpired({ expires_at: future })).toBe(false);
    });
    it('returns true for past expiry', () => {
      const past = new Date(Date.now() - 3600_000).toISOString();
      expect(isQuoteExpired({ expires_at: past })).toBe(true);
    });
  });
});
