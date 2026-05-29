'use strict';

const { check } = require('../utils/clinic-rate-limiter');

describe('clinic rate limiter tier override (T2.5)', () => {
  test('starter tier caps at 30 per minute', () => {
    const key = `tier_test_${Date.now()}`;
    let last;
    for (let i = 0; i < 32; i++) {
      last = check(key, 30);
    }
    expect(last.allowed).toBe(false);
    expect(last.limit).toBe(30);
  });
});
