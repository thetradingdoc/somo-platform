'use strict';

const { test, expect } = require('@playwright/test');

const API_BASE = (process.env.PW_API_BASE_URL || 'http://127.0.0.1:4000').replace(/\/$/, '');

async function stubPatientApis(page) {
  await page.route(/\/api\/patient\//, async (route) => {
    const url = route.request().url();
    if (url.includes('/me')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          patient: { id: 'pat_e2e', name: 'E2E Patient' },
        }),
      });
    }
    if (url.includes('/cards')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, cards: [] }),
      });
    }
    if (url.includes('/features')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          features: { wallet_enabled: true, chat_enabled: false },
        }),
      });
    }
    if (url.includes('/rcm/bill-status')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, bills: [] }),
      });
    }
    if (url.includes('/appointments')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, appointments: [] }),
      });
    }
    if (url.includes('/receipts') || url.includes('/wallet')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, receipts: [], transactions: [] }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true }),
    });
  });
}

test.describe('Patient wallet bills section', () => {
  test.beforeEach(async ({ context }) => {
    await context.addInitScript(() => {
      localStorage.setItem('patient_session_id', 'pw-e2e-wallet-spec');
    });
  });

  test('wallet page includes Bills & claims card', async ({ page }) => {
    await stubPatientApis(page);
    await page.route(/\/patients\/patient-login\.html/, (route) => route.abort());
    await page.goto(`${API_BASE}/patients/wallet.html`, { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/wallet\.html/);
    await expect(page.locator('#billsClaimsCard')).toBeVisible();
    await expect(page.locator('#billsClaimsCard')).toContainText('Bills & claims');
  });
});
