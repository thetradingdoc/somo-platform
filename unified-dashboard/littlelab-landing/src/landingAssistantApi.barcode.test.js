import {
  fetchBarcodeFactsAutodetect,
  fetchBeautyFactsByBarcode,
  fetchFoodFactsByBarcode,
  normalizeHttpApiBase
} from './landingAssistantApi';

describe('normalizeHttpApiBase', () => {
  test('rejects ellipsis-only and strips mistaken ellipsis', () => {
    expect(normalizeHttpApiBase('\u2026')).toBe('');
    expect(normalizeHttpApiBase('http://127.0.0.1:4000\u2026')).toBe('http://127.0.0.1:4000');
  });
});

describe('fetchBeautyFactsByBarcode', () => {
  test('rejects invalid barcode client-side', async () => {
    await expect(fetchBeautyFactsByBarcode({ apiBase: 'http://localhost:4000', barcode: '12' }))
      .rejects
      .toThrow('Invalid barcode');
  });
});

describe('fetchFoodFactsByBarcode', () => {
  test('rejects invalid barcode client-side', async () => {
    await expect(fetchFoodFactsByBarcode({ apiBase: 'http://localhost:4000', barcode: '12' }))
      .rejects
      .toThrow('Invalid barcode');
  });
});

describe('fetchBarcodeFactsAutodetect', () => {
  const origFetch = global.fetch;

  afterEach(() => {
    global.fetch = origFetch;
  });

  test('falls back to Open Food Facts when Open Beauty Facts returns 502', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 502,
        json: async () => ({ success: false, error: 'upstream_timeout' })
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          barcode: '0012993441081',
          data_source: 'live_api',
          product: {
            source: 'open_food_facts',
            barcode: '0012993441081',
            found: true,
            product_name: 'La Croix',
            ingredients_text: 'carbonated water, natural flavor',
            categories_tags: ['en:beverages']
          }
        })
      });

    const out = await fetchBarcodeFactsAutodetect({
      apiBase: 'http://localhost:4000',
      barcode: '0012993441081'
    });
    expect(out.resolvedCatalog).toBe('off');
    expect(out.facts?.product?.product_name).toBe('La Croix');
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});

