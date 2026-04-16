'use strict';

/**
 * Regression: tiles must show human copy (not raw API enums) when served from production build.
 * Run after: cd unified-dashboard/littlelab-landing && npm run build
 */
const { test, expect } = require('@playwright/test');

function foodLikePayload() {
  return {
    success: true,
    session_id: 'sid-copy',
    snapshot_id: 'snap-copy',
    session_result_snapshot: {
      schema_version: '1',
      confidence: { global: 0.52 },
      scanned_product: {
        source: 'open_food_facts',
        category_route: 'food',
        product_name: 'Ice tea',
        ingredients_text: 'Water, high fructose corn syrup, citric acid',
        image_url: null
      },
      scan_summary: {
        tiles: {
          key_actives: {
            status: 'unavailable',
            source: 'deterministic',
            reason_unavailable: 'not_applicable_cosmetic_actives'
          },
          function: {
            status: 'unavailable',
            source: 'deterministic',
            reason_unavailable: 'not_applicable_cosmetic_function'
          },
          skin_type: { status: 'deferred', source: 'none', reason_unavailable: 'no_profile_context' },
          formulation: {
            status: 'available',
            source: 'deterministic',
            confidence: 'low',
            value: 'Liquid (water first)'
          },
          safety_score: { status: 'deferred', source: 'none', reason_unavailable: 'no_scoring_pipeline' }
        }
      },
      result_summary: {
        disclaimer: 'informational_only',
        verdict: {
          product_overview: { what_it_does: 'Food/beverage item.' },
          good_for_me: { answer: 'unknown' },
          harmful: { severity: 'low' },
          children_safe: { answer: 'safe', summary: 'No strong signal from checks.' },
          side_effects: { summary: 'Not assessed in this scan.' },
          alternatives: { status: 'deferred', reason_unavailable: 'insufficient_data' }
        }
      }
    }
  };
}

test.describe('Landing results copy (food / OFF-style)', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try {
        sessionStorage.setItem('littlelab_landing_assistant_sid', 'sid-copy');
      } catch (_) {}
    });
  });

  test('does not surface raw reason_unavailable snake_case in tile bodies', async ({ page }) => {
    await page.route('**/api/public/landing-assistant/results/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(foodLikePayload())
      });
    });
    await page.goto('/#assistant/results', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('region', { name: /Structured summary tiles/i })).toBeVisible();
    await expect(page.getByText(/Not applicable — food\/beverage/i)).toHaveCount(2);
    await expect(page.locator('text=not_applicable_cosmetic')).toHaveCount(0);
    await expect(page.getByText(/Auto-detected/i)).toBeVisible();
    await expect(page.getByText(/Needs profile context/i)).toBeVisible();
  });

  test('verdict shows human disclaimer, not informational_only token', async ({ page }) => {
    await page.route('**/api/public/landing-assistant/results/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(foodLikePayload())
      });
    });
    await page.goto('/#assistant/results', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText(/For informational guidance only/i)).toBeVisible();
    await expect(page.locator('text=informational_only')).toHaveCount(0);
  });
});
