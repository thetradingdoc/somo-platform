'use strict';

const { shouldSkipLandingTurnSeq } = require('../services/landing-turn-seq');

describe('landing-turn-seq', () => {
  test('ignores sequencing when turn_seq is missing or zero', () => {
    expect(shouldSkipLandingTurnSeq(0, 5).skip).toBe(false);
    expect(shouldSkipLandingTurnSeq(NaN, 5).skip).toBe(false);
    expect(shouldSkipLandingTurnSeq(-1, 5).skip).toBe(false);
  });

  test('allows first turn when nothing completed yet', () => {
    expect(shouldSkipLandingTurnSeq(1, 0).skip).toBe(false);
    expect(shouldSkipLandingTurnSeq(1, undefined).skip).toBe(false);
  });

  test('skips duplicate or older seq relative to last completed', () => {
    expect(shouldSkipLandingTurnSeq(3, 5).skip).toBe(true);
    expect(shouldSkipLandingTurnSeq(5, 5).skip).toBe(true);
    expect(shouldSkipLandingTurnSeq(4, 5).skip).toBe(true);
  });

  test('allows strictly newer seq', () => {
    expect(shouldSkipLandingTurnSeq(6, 5).skip).toBe(false);
  });
});
