'use strict';

const { test, expect } = require('@playwright/test');
const {
  isMiddlewareReachable,
  chromiumLaunchable,
  openAssistantChat,
  interceptScanAPI,
  injectBarcode,
  waitForPinnedProduct,
  logResult
} = require('./helpers/scan');

const TEST_BARCODES = [
  { code: '769915190311', label: 'The Ordinary Niacinamide' },
  { code: '8809652637891', label: 'Catalog sample A' },
  { code: '0381370035725', label: 'Catalog sample B' },
  { code: '0850026819076', label: 'Catalog sample C' }
];

const coverageReport = [];

test.describe('Scan catalog coverage', () => {
  test('middleware health is reachable', async ({ request }) => {
    expect(await isMiddlewareReachable(request)).toBeTruthy();
  });

  for (const { code, label } of TEST_BARCODES) {
    test(`[${code}] ${label} resolves data source`, async ({ page, request }) => {
      test.skip(!(await chromiumLaunchable()), 'Chromium browser cannot launch in this environment');
      test.skip(!(await isMiddlewareReachable(request)), 'middleware not reachable');
      const captured = await interceptScanAPI(page);
      await openAssistantChat(page);
      const injectionMethod = await injectBarcode(page, code);
      const pinnedText = await waitForPinnedProduct(page, 30000).catch(() => '');

      const entry = {
        barcode: code,
        label,
        dataSource: captured.dataSource,
        productName: captured.productName,
        endpoint: captured.endpoint,
        status: captured.status,
        injectionMethod,
        pinnedText
      };
      coverageReport.push(entry);
      logResult(`Coverage ${code}`, entry);

      expect(captured.dataSource).not.toBe(null);
      expect(captured.status).toBeGreaterThanOrEqual(200);
      expect(captured.status).toBeLessThan(600);
    });
  }

  test('catalog responses include source metadata shape', async ({ page, request }) => {
    test.skip(!(await chromiumLaunchable()), 'Chromium browser cannot launch in this environment');
    test.skip(!(await isMiddlewareReachable(request)), 'middleware not reachable');
    const captured = await interceptScanAPI(page);
    await openAssistantChat(page);
    await injectBarcode(page, TEST_BARCODES[0].code);
    await page.waitForTimeout(1200);
    expect(typeof captured.dataSource).toBe('string');
    expect(captured.dataSource.length).toBeGreaterThan(0);
  });

  test.afterAll(async () => {
    const total = coverageReport.length;
    const indexHits = coverageReport.filter((e) => String(e.dataSource || '').includes('index_cache')).length;
    const liveHits = coverageReport.filter((e) => String(e.dataSource || '').includes('live')).length;
    const unknown = coverageReport.filter((e) => !e.dataSource || e.dataSource === 'unknown').length;
    const hitRate = total > 0 ? Math.round((indexHits / total) * 100) : 0;

    console.log('\n=== Scan Catalog Coverage Summary ===');
    console.log(`Total barcodes tested: ${total}`);
    console.log(`Master index hits: ${indexHits}`);
    console.log(`Live fallback hits: ${liveHits}`);
    console.log(`Unknown source: ${unknown}`);
    console.log(`Master hit rate: ${hitRate}%`);
  });
});

