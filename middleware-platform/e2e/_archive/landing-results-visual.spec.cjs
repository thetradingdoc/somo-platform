'use strict';

const { test, expect } = require('@playwright/test');

function snapshotPayload(override = {}) {
  return {
    success: true,
    session_id: 'sid-visual',
    snapshot_id: 'snap-visual',
    session_result_snapshot: {
      schema_version: '1',
      generated_at: new Date().toISOString(),
      confidence: { global: 0.72 },
      scanned_product: {
        source: 'open_beauty_facts',
        barcode: '3033490000282',
        product_name: 'Visual Test Product',
        ingredients_text: 'Water, Niacinamide 10%, Zinc PCA 1%',
        image_url: null
      },
      scan_summary: {
        schema_version: '1',
        generated_at: new Date().toISOString(),
        tiles: {
          key_actives: { status: 'available', source: 'deterministic', confidence: 'high', value: [{ display: 'Niacinamide 10%' }], reason_unavailable: null },
          formulation: { status: 'available', source: 'deterministic', confidence: 'medium', value: 'Water-Based', reason_unavailable: null },
          function: { status: 'available', source: 'deterministic', confidence: 'medium', value: ['blemish_control'], reason_unavailable: null },
          skin_type: { status: 'deferred', source: 'none', confidence: null, value: null, reason_unavailable: 'no_profile_context' },
          safety_score: { status: 'deferred', source: 'none', confidence: null, value: null, reason_unavailable: 'no_scoring_pipeline' }
        }
      },
      result_summary: {
        schema_version: '1',
        generated_at: new Date().toISOString(),
        disclaimer: 'informational_only',
        tiles: {},
        verdict: {
          good_for_me: { answer: 'yes', summary: 'Fits your session context.' },
          harmful: { severity: 'low' }
        }
      },
      ...override
    }
  };
}

test.describe('Landing results visual snapshots', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try {
        sessionStorage.setItem('littlelab_landing_assistant_sid', 'sid-visual');
      } catch (_) {}
    });
    await page.route('**/api/public/landing-assistant/results/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(snapshotPayload())
      });
    });
  });

  test('found known state visual baseline', async ({ page }) => {
    await page.goto('/#assistant/results', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.arp-root')).toBeVisible();
    await expect(page.locator('.arp-root')).toHaveScreenshot('results-found-known.png', {
      animations: 'disabled',
      caret: 'hide'
    });
  });

  test('found unknown state visual baseline', async ({ page }) => {
    await page.route('**/api/public/landing-assistant/results/**', async (route) => {
      const payload = snapshotPayload({
        scanned_product: {
          source: 'open_beauty_facts',
          barcode: '0000000000000',
          product_name: 'Unknown Route Product',
          ingredients_text: 'Water'
        }
      });
      payload.session_result_snapshot.scan_summary.tiles.function = {
        status: 'unavailable',
        source: 'deterministic',
        confidence: null,
        value: null,
        reason_unavailable: 'category_unknown'
      };
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) });
    });
    await page.goto('/#assistant/results', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.arp-root')).toBeVisible();
    await expect(page.locator('.arp-root')).toHaveScreenshot('results-found-unknown.png', {
      animations: 'disabled',
      caret: 'hide'
    });
  });

  test('not found state visual baseline', async ({ page }) => {
    await page.route('**/api/public/landing-assistant/results/**', async (route) => {
      const payload = snapshotPayload({
        scanned_product: {
          lookup_status: 'not_found',
          source: 'both',
          barcode: '9999999999999',
          product_name: null,
          ingredients_text: null
        },
        scan_summary: null,
        result_summary: null
      });
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) });
    });
    await page.goto('/#assistant/results', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.arp-root')).toBeVisible();
    await expect(page.locator('.arp-root')).toHaveScreenshot('results-not-found.png', {
      animations: 'disabled',
      caret: 'hide'
    });
  });

  test('mobile parity baseline with accessible regions', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/#assistant/results', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('dialog', { name: /Scan results/i })).toBeVisible();
    await expect(page.getByRole('region', { name: /Structured summary tiles/i })).toBeVisible();
    await expect(page.getByRole('region', { name: /Deterministic verdict block/i })).toBeVisible();
    await expect(page.locator('.arp-root')).toHaveScreenshot('results-mobile-parity.png', {
      animations: 'disabled',
      caret: 'hide'
    });
  });
});
