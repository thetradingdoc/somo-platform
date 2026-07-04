'use strict';

const { test, expect } = require('@playwright/test');
const { UI_BASE } = require('./helpers/callsomo-urls.cjs');

test.describe('callsomo.com public homepage', () => {
  test('root does not redirect anonymous visitors to login', async ({ page }) => {
    await page.goto(`${UI_BASE}/`, { waitUntil: 'networkidle' });
    await expect(page).not.toHaveURL(/\/login/i);
  });

  test('root shows B2B marketing hero', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${UI_BASE}/`, { waitUntil: 'domcontentloaded' });
    await expect(page).not.toHaveURL(/\/login/i);
    await expect(page.locator('.somo-logo-img')).toBeVisible({ timeout: 15000 });
    await expect(
      page.getByRole('heading', { name: /never answer business calls again/i })
    ).toBeVisible({ timeout: 15000 });
  });
});
