'use strict';

const { routeAfterLayer2 } = require('../services/step10-graph');

describe('step10-graph routeAfterLayer2', () => {
  test('short when low_confidence flag', () => {
    expect(routeAfterLayer2({ inputs: { low_confidence: true } })).toBe('short');
    expect(routeAfterLayer2({ inputs: { low_confidence: '1' } })).toBe('short');
  });

  test('short when confidence below threshold', () => {
    expect(routeAfterLayer2({ inputs: { confidence: 0.2 } })).toBe('short');
  });

  test('full when confidence high or absent', () => {
    expect(routeAfterLayer2({ inputs: { confidence: 0.9 } })).toBe('full');
    expect(routeAfterLayer2({ inputs: {} })).toBe('full');
    expect(routeAfterLayer2({})).toBe('full');
  });
});
