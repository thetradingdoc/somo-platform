'use strict';

jest.mock('../database', () => ({
  upsertObfIndexProduct: jest.fn(() => ({ success: true }))
}));

describe('open-beauty-facts retry/timeout handling', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.OBF_HTTP_MAX_RETRIES;
    jest.resetModules();
  });

  test('retries once then succeeds', async () => {
    process.env.OBF_HTTP_MAX_RETRIES = '1';
    let calls = 0;
    global.fetch = jest.fn(async () => {
      calls += 1;
      if (calls === 1) throw new Error('network_down');
      return {
        ok: true,
        json: async () => ({ status: 1, code: '12345678', product: { product_name: 'Retry OK' } })
      };
    });
    jest.resetModules();
    const svc = require('../services/open-beauty-facts-service');
    const out = await svc.fetchBeautyFactsByBarcode('12345678');
    expect(out.success).toBe(true);
    expect(calls).toBeGreaterThanOrEqual(2);
  });

  test('returns upstream_timeout after retry budget exhausted', async () => {
    const err = new Error('timeout');
    err.name = 'AbortError';
    global.fetch = jest.fn(async () => {
      throw err;
    });
    const svc = require('../services/open-beauty-facts-service');
    const out = await svc.fetchBeautyFactsByBarcode('12345678');
    expect(out.success).toBe(false);
    expect(out.error).toBe('upstream_timeout');
  });
});

