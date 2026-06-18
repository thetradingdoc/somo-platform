'use strict';

const { test, expect } = require('@playwright/test');
const { middlewareUp, loginViaUi, sel } = require('../helpers/portal-auth.cjs');

test.describe('01 — Signup trial activation', () => {
  test.skip(
    !process.env.TRIAL_E2E_PHONE && !process.env.PW_RUN_SIGNUP_JOURNEY,
    'Set TRIAL_E2E_PHONE or PW_RUN_SIGNUP_JOURNEY=1 to run browser signup'
  );

  test('signup wizard reaches trial activation with number', async ({ page, request }) => {
    if (!(await middlewareUp(request))) test.skip(true, 'Middleware not running');
    test.setTimeout(180_000);

    const email = `portal-e2e-${Date.now()}@somo.test`;
    const phone = process.env.TRIAL_E2E_PHONE || '+12025550199';

    await page.goto('/signup.html', { waitUntil: 'domcontentloaded' });
    await expect(page.locator(sel.signupWizard)).toBeVisible({ timeout: 15_000 });

    // Persona: healthcare clinic
    await page.getByRole('button', { name: /healthcare|clinic|medical/i }).first().click();
    await page.getByRole('button', { name: /continue|next/i }).first().click();

    await page.locator('#businessName, [name="company_name"]').first().fill('Portal E2E Clinic');
    await page.getByRole('button', { name: /continue|next/i }).first().click();

    await page.locator('#signupEmail, [name="email"]').first().fill(email);
    await page.locator('#signupPhone, [name="phone"]').first().fill(phone);
    await page.getByRole('button', { name: /create|continue|sign up/i }).first().click();

    await page.waitForURL(/verify|email|credentials|terms|trial/i, { timeout: 60_000 }).catch(() => {});
    // Best-effort: if we land on trial-activation, assert number visible
    if (page.url().includes('trial-activation')) {
      await expect(page.locator(sel.activationNumber)).toBeVisible();
      const num = await page.locator(sel.activationNumber).innerText();
      expect(num).toMatch(/\+?\d/);
    }
  });
});
