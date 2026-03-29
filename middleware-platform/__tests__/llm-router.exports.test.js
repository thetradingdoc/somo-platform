'use strict';

describe('llm-router', () => {
  it('exports callStreamWithDeltas and resolvePrimaryProvider', () => {
    const L = require('../services/llm-router');
    expect(L.callStreamWithDeltas).toBeDefined();
    expect(typeof L.callStreamWithDeltas).toBe('function');
    expect(L.resolvePrimaryProvider).toBeDefined();
    expect(typeof L.resolvePrimaryProvider).toBe('function');
  });
});
