'use strict';

const { test, expect } = require('@playwright/test');

const API_BASE = (process.env.PW_API_BASE_URL || 'http://127.0.0.1:4000').replace(/\/$/, '');
const EMAIL = process.env.PW_PROVIDER_EMAIL || 'provider@callsomo.com';
const PASS = process.env.PW_PROVIDER_PASS || process.env.PW_PROVIDER_PASSWORD || 'demo123';

async function middlewareUp(request) {
  try {
    const health = await request.get(`${API_BASE}/health`, { timeout: 8_000 });
    return health.ok();
  } catch {
    return false;
  }
}

test.describe('Provider Today portal — static assets + shell', () => {
  test.beforeAll(async ({ request }) => {
    if (!(await middlewareUp(request))) {
      test.skip(true, 'Middleware not running on :4000');
    }
  });

  test('serves portal config.js as JavaScript, not landing HTML', async ({ request }) => {
    const res = await request.get(`${API_BASE}/assets/js/config.js`);
    expect(res.ok()).toBeTruthy();
    const body = await res.text();
    expect(body).toMatch(/API Configuration|getApiBase/i);
    expect(body).not.toMatch(/<html/i);
  });

  test('Today page loads styled sidebar after provider login', async ({ page, request }) => {
    const loginRes = await request.post(`${API_BASE}/api/customers/login`, {
      data: { email: EMAIL, password: PASS, remember_me: true },
    });
    const loginJson = await loginRes.json();
    expect(loginRes.ok()).toBeTruthy();
    expect(loginJson.success).toBe(true);

    const customer = loginJson.customer || {};
    await page.goto(`${API_BASE}/login`, { waitUntil: 'domcontentloaded' });
    await page.evaluate((c) => {
      sessionStorage.setItem('authenticated', 'true');
      sessionStorage.setItem('customer', JSON.stringify(c));
      sessionStorage.setItem(
        'user',
        JSON.stringify({ name: c.name || 'Provider', role: c.role || 'Provider', ...c })
      );
    }, customer);

    const consoleErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto(`${API_BASE}/business/today.html`, { waitUntil: 'networkidle' });

    await expect(page.locator('.pp-sidebar')).toBeVisible();
    await expect(page.locator('.pp-topbar')).toBeVisible();

    const shellReady = await page.evaluate(() => {
      const sidebar = document.querySelector('.pp-sidebar');
      const bg = sidebar ? window.getComputedStyle(sidebar).backgroundColor : '';
      return {
        greetingFn: typeof window.ppGreetingName === 'function',
        sidebarBg: bg,
      };
    });
    expect(shellReady.greetingFn).toBe(true);
    expect(shellReady.sidebarBg).not.toBe('rgba(0, 0, 0, 0)');

    const assetSyntax = consoleErrors.filter(
      (t) =>
        /Unexpected token|Unexpected end of input|ppGreetingName is not a function/i.test(t) &&
        !/contentscript|ObjectMultiplex/i.test(t)
    );
    expect(assetSyntax, assetSyntax.join('\n')).toEqual([]);
  });
});
