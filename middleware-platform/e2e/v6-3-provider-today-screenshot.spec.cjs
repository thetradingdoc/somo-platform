/**
 * V6-3 — Provider today.html after Kelly Rails v2–equivalent seed (today's appointment + clinical prep).
 *
 * Writes:
 *   e2e-artifacts/v6-3-today-after-v2.png
 *   e2e-artifacts/v6-3-calendar-clinical-prep-after-v2.png
 *
 * Requires middleware on :4000 using the same DB_PATH (default middleware-dev.db).
 *
 *   PW_PROVIDER_EMAIL=provider@callsomo.com PW_PROVIDER_PASS=demo123 \\
 *   npx playwright test e2e/v6-3-provider-today-screenshot.spec.cjs --project provider-portal
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

const fixtures = require('./helpers/kelly-conversation-fixtures.cjs');

const API_BASE = (process.env.PW_API_BASE_URL || 'http://127.0.0.1:4000').replace(/\/$/, '');
const EMAIL = process.env.PW_PROVIDER_EMAIL || 'provider@callsomo.com';
const PASS = process.env.PW_PROVIDER_PASS || process.env.PW_PROVIDER_PASSWORD || 'demo123';
const ARTIFACT_DIR = path.join(__dirname, '..', 'e2e-artifacts');
const TODAY_SHOT = path.join(ARTIFACT_DIR, 'v6-3-today-after-v2.png');
const CAL_SHOT = path.join(ARTIFACT_DIR, 'v6-3-calendar-clinical-prep-after-v2.png');

let seed = null;

test.describe.configure({ mode: 'serial' });

async function middlewareUp(request) {
  try {
    const health = await request.get(`${API_BASE}/health`, { timeout: 8_000 });
    return health.ok();
  } catch {
    return false;
  }
}

async function providerLogin(request) {
  const loginRes = await request.post(`${API_BASE}/api/customers/login`, {
    data: { email: EMAIL, password: PASS, remember_me: true },
  });
  const loginJson = await loginRes.json();
  expect(loginRes.ok(), `login HTTP ${loginRes.status()}`).toBeTruthy();
  expect(loginJson.success, loginJson.error || 'login failed').toBe(true);
  return loginJson.customer || {};
}

async function injectProviderSession(page, customer) {
  const withClinic = { ...customer, clinic_id: customer.clinic_id || seed?.clinicId || 'clinic-default' };
  await page.goto(`${API_BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.evaluate((c) => {
    sessionStorage.setItem('authenticated', 'true');
    sessionStorage.setItem('customer', JSON.stringify(c));
    sessionStorage.setItem(
      'user',
      JSON.stringify({ name: c.name || 'Provider', role: c.role || 'Provider', ...c })
    );
  }, withClinic);
}

test.describe('V6-3 provider dashboard after v2 seed', () => {
  test.beforeAll(async ({ request }) => {
    if (!(await middlewareUp(request))) {
      test.skip(true, 'Middleware not running on :4000');
    }

    process.chdir(path.join(__dirname, '..'));
    process.env.DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'middleware-dev.db');
    const uniqueMin = new Date().getMinutes() % 30;
    seed = await fixtures.seedV2ProviderDashboardToday({
      providerEmail: EMAIL,
      appointmentId: `appt_v6_3_${Date.now()}`,
      minute: uniqueMin,
    });

    fixtures.assertClinicalPrepInProcess(seed.appointmentId, seed.sessionId, {
      requireCaseSummary: true,
    });
  });

  test('today.html shows Tom Harris on today schedule + screenshot', async ({ page, request }) => {
    test.skip(!seed?.appointmentId, 'seed missing');

    const customer = await providerLogin(request);
    await injectProviderSession(page, customer);

    const consoleErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto(`${API_BASE}/business/today.html`, { waitUntil: 'networkidle' });

    await expect(page.locator('.pp-sidebar')).toBeVisible();
    await expect(page.locator('#scheduleList')).toBeVisible();

    await expect(page.locator('#scheduleList')).toContainText('Tom Harris', { timeout: 20_000 });
    await expect(page.locator('#scheduleList')).toContainText(/Dermatology/i);

    const sub = await page.locator('#scheduleSub').textContent();
    expect(sub || '').toMatch(/\d+ appointments/i);

    const assetSyntax = consoleErrors.filter(
      (t) =>
        /Unexpected token|Unexpected end of input|ppGreetingName is not a function/i.test(t) &&
        !/contentscript|ObjectMultiplex/i.test(t)
    );
    expect(assetSyntax, assetSyntax.join('\n')).toEqual([]);

    fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
    await page.screenshot({ path: TODAY_SHOT, fullPage: true });
    console.log(`\nV6-3 today screenshot: ${TODAY_SHOT}`);
    console.log(`  session_id=${seed.sessionId} appointment_id=${seed.appointmentId} date=${seed.todaySlot.dateStr}\n`);
  });

  test('calendar clinical-prep panel screenshot', async ({ page, request }) => {
    test.skip(!seed?.appointmentId, 'seed missing');

    const customer = await providerLogin(request);
    await injectProviderSession(page, customer);

    await page.goto(`${API_BASE}/business/calendar.html`, { waitUntil: 'networkidle' });

    const apptId = seed.appointmentId;
    await page.evaluate(async (id) => {
      if (typeof window.selectAppointment === 'function') {
        window.selectAppointment(id);
        return;
      }
      const link = document.querySelector(`[data-appointment-id="${id}"]`);
      if (link) link.click();
    }, apptId);

    await page.waitForTimeout(1500);

    const hasTom = await page.locator('body').textContent();
    expect(hasTom || '').toMatch(/Tom Harris|clinical|triage|rash/i);

    fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
    await page.screenshot({ path: CAL_SHOT, fullPage: true });
    console.log(`\nV6-3 calendar screenshot: ${CAL_SHOT}\n`);
  });
});
