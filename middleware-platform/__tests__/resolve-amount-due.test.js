'use strict';

const { resolveAmountDue } = require('../services/resolve-amount-due');

describe('resolve-amount-due', () => {
  test('exports resolveAmountDue function', () => {
    expect(typeof resolveAmountDue).toBe('function');
  });

  test('returns cannot_determine without patient or session', async () => {
    const r = await resolveAmountDue({});
    expect(r.status).toBe('cannot_determine');
  });
});
