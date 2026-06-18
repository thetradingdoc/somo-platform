'use strict';

const { test, expect } = require('@playwright/test');
const {
  middlewareUp,
  loginViaUi,
  gotoProviderPage,
  loginProviderViaApi,
  API_BASE,
  sel
} = require('../helpers/portal-auth.cjs');

test.describe('07 — Agent control center', () => {
  test('Kelly toggle and stats region visible', async ({ page, request }) => {
    if (!(await middlewareUp(request))) test.skip(true, 'Middleware not running');
    await loginViaUi(page, request);
    await page.goto(`${API_BASE}/business/agent.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForURL(/agent\.html|voice-setup\.html/, { timeout: 20_000 });
    if (page.url().includes('voice-setup')) {
      await expect(page.getByRole('heading', { name: /practice/i })).toBeVisible({ timeout: 15_000 });
      return;
    }
    await expect(page.locator(sel.agentToggle)).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-testid="agent-recent-calls"]').first()).toBeVisible({
      timeout: 20_000
    });
  });
});
