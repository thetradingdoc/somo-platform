import {
  fetchBarcodeFactsAutodetect,
  fetchBeautyFactsByBarcode,
  fetchFoodFactsByBarcode,
  middlewareApiBaseFromLocation,
  normalizeHttpApiBase
} from './landingAssistantApi';

describe('middlewareApiBaseFromLocation', () => {
  test('env wins over location', () => {
    expect(
      middlewareApiBaseFromLocation('https://api.example.com/', {
        hostname: 'localhost',
        port: '3000',
        origin: 'http://localhost:3000'
      })
    ).toBe('https://api.example.com');
  });

  test('localhost Vite :5173 points to middleware :4000', () => {
    expect(
      middlewareApiBaseFromLocation('', {
        hostname: 'localhost',
        port: '5173',
        origin: 'http://localhost:5173'
      })
    ).toBe('http://localhost:4000');
  });

  test('localhost :4000 stays same-origin', () => {
    expect(
      middlewareApiBaseFromLocation('', {
        hostname: 'localhost',
        port: '4000',
        origin: 'http://localhost:4000'
      })
    ).toBe('http://localhost:4000');
  });

  test('production host without env uses current origin', () => {
    expect(
      middlewareApiBaseFromLocation('', {
        hostname: 'app.example.com',
        port: '',
        origin: 'https://app.example.com'
      })
    ).toBe('https://app.example.com');
  });
});

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

