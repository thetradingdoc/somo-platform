'use strict';

const { isSkinConcern, SKIN_FRAGMENTS } = require('../services/health-video-skin-router');

describe('health-video-skin-router', () => {
  test('all skin keyword fragments are detected', () => {
    for (const fragment of SKIN_FRAGMENTS) {
      expect(isSkinConcern(`I have a ${fragment} on my arm`)).toBe(true);
    }
  });

  test('non-skin complaints are not routed as skin', () => {
    expect(isSkinConcern('I have a headache and nausea')).toBe(false);
    expect(isSkinConcern('My knee hurts when I walk')).toBe(false);
  });

  test('explicit rash negation returns false', () => {
    expect(isSkinConcern("I don't have a rash")).toBe(false);
    expect(isSkinConcern('without rash')).toBe(false);
  });
});
