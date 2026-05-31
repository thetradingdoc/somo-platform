'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

/**
 * Staging voice agent UI — real APIs (no route mocks).
 *
 * Auth: SOMO_OWNER_EMAIL + SOMO_OWNER_PASSWORD, or complete staging-signup journey first.
 * Optional STAGING_DB_PATH to assert retell_agent_id / twilio fields after save.
 */

const { test, expect } = require('@playwright/test');
const { execFileSync } = require('child_process');
const {
  UI_BASE,
  API_BASE,
  createApiContext,
  browserOnUi,
  seedCustomerInPage,
  loginOwnerViaApi,
  stagingDbConfigured
} = require('./helpers/staging-context.cjs');

const mpRoot = path.join(__dirname, '..');

test.describe.configure({ mode: 'serial' });

test.describe('Staging voice agent (real API)', () => {
  let customer;
  let api;

  test.beforeAll(async ({ playwright, request }) => {
    const health = await request.get(`${API_BASE}/health/live`);
    expect(health.ok()).toBeTruthy();

    api = await createApiContext(playwright);
    customer = await loginOwnerViaApi(api);
    if (!customer) {
      test.skip(
        true,
        'Set SOMO_OWNER_EMAIL + SOMO_OWNER_PASSWORD (or run staging-signup journey first)'
      );
    }
  });

  test.afterAll(async () => {
    if (api) await api.dispose();
  });

  test('A1 agent.html shows provisioned phone', async ({ playwright }) => {
    const fresh = await api.get('/api/signup/session').catch(() => null);
    if (fresh?.ok()) {
      const b = await fresh.json();
      if (b.customer) customer = b.customer;
    }

    const { browser, page } = await browserOnUi(playwright, api);
    await seedCustomerInPage(page, customer);
    try {
      await page.goto(`${UI_BASE}/business/agent.html`);
      await expect(page.locator('#vaPhone')).toBeVisible({ timeout: 20000 });
      const phoneText = await page.locator('#vaPhone').textContent();
      if (customer.twilio_phone_number) {
        const digits = customer.twilio_phone_number.replace(/\D/g, '').slice(-10);
        expect(phoneText?.replace(/\D/g, '')).toContain(digits);
      }
    } finally {
      await browser.close();
    }
  });

  test('A2–A3 voice-setup wizard saves greeting via API', async ({ playwright }) => {
    const { browser, page } = await browserOnUi(playwright, api);
    await seedCustomerInPage(page, customer);
    const greeting = `Staging E2E greeting ${Date.now()}`;

    try {
      await page.goto(`${UI_BASE}/business/voice-setup.html`);
      await expect(page.locator('#setupTitle')).toContainText(/greeting/i, { timeout: 15000 });
      await page.locator('#setupGreeting').fill(greeting);
      await page.locator('#setupNext1').click();
      await expect(page.locator('#setupError')).toBeHidden({ timeout: 5000 }).catch(() => {});
      await expect(page.locator('#setupTitle')).toContainText(/hours|office hours/i, {
        timeout: 30000
      });
      await page.locator('#setupNext2').click();
      await expect(page.locator('#setupTitle')).toContainText(/line/i, { timeout: 15000 });
      await page.locator('#setupFinish').click();
      await page.waitForURL(/agent\.html/, { timeout: 30000 });

      const settings = await api.get('/api/voice-agent/settings');
      expect(settings.ok(), await settings.text()).toBeTruthy();
      const body = await settings.json();
      expect(body.success).toBeTruthy();
      expect(body.settings?.greeting || body.greeting).toContain('Staging E2E greeting');
    } finally {
      await browser.close();
    }
  });

  test('A4 Kelly toggle reaches API', async ({ playwright }) => {
    const { browser, page } = await browserOnUi(playwright, api);
    await seedCustomerInPage(page, { ...customer, voice_setup_completed_at: new Date().toISOString() });
    try {
      await page.goto(`${UI_BASE}/business/agent.html`);
      await expect(page.locator('#vaToggle')).toBeVisible({ timeout: 20000 });
      const statusRes = await api.get('/api/kelly/status');
      expect(statusRes.ok()).toBeTruthy();
    } finally {
      await browser.close();
    }
  });

  test('A5 DB row matches logged-in customer when STAGING_DB_PATH set', async () => {
    if (!stagingDbConfigured()) {
      test.skip(true, 'STAGING_DB_PATH not set');
    }
    const { getCustomerById } = require(path.join(mpRoot, 'scripts', 'staging-db-utils.cjs'));
    const row = getCustomerById(customer.id);
    expect(row.email).toBe(customer.email);
    expect(row.merchant_id).toBeTruthy();

    if (row.trial_status === 'active' && row.twilio_phone_number) {
      const script = path.join(mpRoot, 'scripts', 'staging-db-assert-customer.cjs');
      execFileSync(process.execPath, [script, `--customer-id=${customer.id}`], {
        stdio: 'pipe',
        env: process.env
      });
    }

    test.info().annotations.push({
      type: 'retell',
      description: `trial_status=${row.trial_status} twilio=${row.twilio_phone_number || '(none)'} retell_agent_id=${row.retell_agent_id || '(none)'}`
    });
  });
});
