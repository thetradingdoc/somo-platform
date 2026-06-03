'use strict';

const { test, expect } = require('@playwright/test');

const API_BASE = (process.env.PW_API_BASE_URL || 'http://127.0.0.1:4000').replace(/\/$/, '');
const EMAIL = process.env.PW_PROVIDER_EMAIL || 'provider@doclittle.com';
const PASS = process.env.PW_PROVIDER_PASS || process.env.PW_PROVIDER_PASSWORD || 'demo123';

async function middlewareUp(request) {
  try {
    const health = await request.get(`${API_BASE}/health`, { timeout: 8_000 });
    return health.ok();
  } catch {
    return false;
  }
}

async function seedProviderSession(page, request) {
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

  test('Today page: greeting topbar, 2-col grid, no attention panels', async ({ page, request }) => {
    await seedProviderSession(page, request);

    const consoleErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto(`${API_BASE}/business/today.html`, { waitUntil: 'networkidle' });

    await expect(page.locator('.pp-sidebar')).toBeVisible();
    await expect(page.locator('.pp-topbar--page')).toBeVisible();
    await expect(page.locator('#ppHeroGreeting')).toBeVisible();
    await expect(page.locator('.pp-hero')).toHaveCount(0);
    await expect(page.locator('.pp-dashboard-attention')).toHaveCount(0);
    await expect(page.locator('#recentMessagesPanel')).toBeVisible();

    const layout = await page.evaluate(() => {
      const sidebar = document.querySelector('.pp-sidebar');
      const bg = sidebar ? window.getComputedStyle(sidebar).backgroundColor : '';
      const alertStrip = document.getElementById('ppAlertStrip');
      const kpi = document.getElementById('kpiRow');
      const main = document.querySelector('.pp-dashboard-main');
      const aside = document.querySelector('.pp-dashboard-aside');
      const pos = (el) => (el ? el.getBoundingClientRect().top : 0);
      const brandImg = document.querySelector('.pp-sb-brand img');
      return {
        greetingFn: typeof window.ppGreetingName === 'function',
        sidebarBg: bg,
        alertBeforeKpi: !alertStrip || alertStrip.hidden || pos(alertStrip) < pos(kpi),
        mainBeforeAside: !!main && !!aside && pos(main) < pos(aside),
        appointmentsInMain: !!main && !!main.querySelector('#scheduleList'),
        brandIcon: brandImg ? brandImg.getAttribute('src') || '' : '',
        hasUrgentPanel: !!document.querySelector('#activityFeed'),
      };
    });
    expect(layout.greetingFn).toBe(true);
    expect(layout.sidebarBg).not.toBe('rgba(0, 0, 0, 0)');
    expect(layout.alertBeforeKpi).toBe(true);
    expect(layout.mainBeforeAside).toBe(true);
    expect(layout.appointmentsInMain).toBe(true);
    expect(layout.brandIcon).toMatch(/somo-icon\.png/);
    expect(layout.hasUrgentPanel).toBe(false);

    const buttons = await page.evaluate(() => {
      const search = document.getElementById('ppSearchBtn');
      const primary = document.getElementById('ppNewApptBtn');
      const cs = (el) => (el ? window.getComputedStyle(el) : null);
      const searchStyle = cs(search);
      const primaryStyle = cs(primary);
      return {
        searchOutline: search?.classList.contains('pp-btn-outline'),
        primaryGreen: primaryStyle?.backgroundColor?.includes('22, 166, 55') || primaryStyle?.backgroundColor?.includes('rgb(22, 166, 55)'),
        searchBorderWidth: searchStyle ? parseFloat(searchStyle.borderWidth) : 0,
        ghostPanelLink: !!document.querySelector('.pp-panel-head .pp-btn-link'),
      };
    });
    expect(buttons.searchOutline).toBe(true);
    expect(buttons.primaryGreen).toBe(true);
    expect(buttons.searchBorderWidth).toBeGreaterThan(0);
    expect(buttons.ghostPanelLink).toBe(true);

    const assetSyntax = consoleErrors.filter(
      (t) =>
        /Unexpected token|Unexpected end of input|ppGreetingName is not a function/i.test(t) &&
        !/contentscript|ObjectMultiplex/i.test(t)
    );
    expect(assetSyntax, assetSyntax.join('\n')).toEqual([]);
  });

  test('Today page title uses shell 28px scale', async ({ page, request }) => {
    await seedProviderSession(page, request);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${API_BASE}/business/today.html`, { waitUntil: 'networkidle' });

    const titlePx = await page.evaluate(() => {
      const el = document.getElementById('ppHeroGreeting');
      return el ? parseFloat(window.getComputedStyle(el).fontSize) : 0;
    });
    expect(titlePx).toBeGreaterThanOrEqual(26);
    expect(titlePx).toBeLessThanOrEqual(30);
  });

  test('Today page desktop: appointments full width, equal comms row', async ({ page, request }) => {
    await seedProviderSession(page, request);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${API_BASE}/business/today.html`, { waitUntil: 'networkidle' });

    const desktop = await page.evaluate(() => {
      const main = document.querySelector('.pp-dashboard-main');
      const aside = document.querySelector('.pp-dashboard-aside');
      const messagesPanel = document.getElementById('recentMessagesPanel')?.closest('.pp-panel');
      const kellyPanel = document.getElementById('kellyActivityPanel')?.closest('.pp-panel');
      const callsPanel = document.getElementById('recentCallsPanel')?.closest('.pp-panel');
      const grid = document.querySelector('.pp-content--today .pp-dashboard-grid');
      const top = (el) => (el ? el.getBoundingClientRect().top : 0);
      const left = (el) => (el ? el.getBoundingClientRect().left : 0);
      const width = (el) => (el ? el.getBoundingClientRect().width : 0);
      const gridStyle = grid ? window.getComputedStyle(grid) : null;
      const asideStyle = aside ? window.getComputedStyle(aside) : null;
      return {
        mainBeforeAside: top(main) < top(aside),
        mainFullWidth: width(main) >= width(grid) * 0.95,
        asideIsGrid: asideStyle?.display === 'grid',
        asideTwoCols: (asideStyle?.gridTemplateColumns || '').trim().split(/\s+/).filter(Boolean).length >= 2,
        commPanelCount: document.querySelectorAll('.pp-dashboard-aside .pp-panel--comms').length,
        messagesKellySideBySide:
          !!messagesPanel &&
          !!kellyPanel &&
          Math.abs(top(messagesPanel) - top(kellyPanel)) < 8 &&
          left(messagesPanel) < left(kellyPanel),
        callsBelowCommsRow:
          !!callsPanel &&
          !!messagesPanel &&
          top(callsPanel) > top(messagesPanel) + 20,
        gridAreas: gridStyle?.gridTemplateAreas || '',
      };
    });
    expect(desktop.mainBeforeAside).toBe(true);
    expect(desktop.mainFullWidth).toBe(true);
    expect(desktop.asideIsGrid).toBe(true);
    expect(desktop.asideTwoCols).toBe(true);
    expect(desktop.commPanelCount).toBeGreaterThanOrEqual(3);
    expect(desktop.messagesKellySideBySide).toBe(true);
    expect(desktop.callsBelowCommsRow).toBe(true);
    expect(desktop.gridAreas).toMatch(/main.*main/i);
  });

  test('Today page: Kelly activity panel present', async ({ page, request }) => {
    await seedProviderSession(page, request);
    await page.goto(`${API_BASE}/business/today.html`, { waitUntil: 'networkidle' });
    await expect(page.locator('#kellyActivityPanel')).toBeVisible();
    await expect(page.getByText('Kelly activity')).toBeVisible();
  });

  test('Today page mobile: stacked grid, topbar padding', async ({ page, request }) => {
    await seedProviderSession(page, request);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${API_BASE}/business/today.html`, { waitUntil: 'networkidle' });

    const mobile = await page.evaluate(() => {
      const kpi = document.getElementById('kpiRow');
      const main = document.querySelector('.pp-dashboard-main');
      const aside = document.querySelector('.pp-dashboard-aside');
      const topbar = document.querySelector('.pp-topbar');
      const pos = (el) => (el ? el.getBoundingClientRect().top : 0);
      const padLeft = topbar ? parseFloat(window.getComputedStyle(topbar).paddingLeft) : 0;
      const ctaLabel = document.querySelector('#ppNewApptBtn .pp-topbar-cta-label');
      const ctaDisplay = ctaLabel ? window.getComputedStyle(ctaLabel).display : 'none';
      return {
        mainBeforeAside: pos(main) < pos(aside),
        topbarPadLeft: padLeft,
        ctaLabelVisible: ctaDisplay !== 'none',
      };
    });
    expect(mobile.mainBeforeAside).toBe(true);
    expect(mobile.topbarPadLeft).toBeGreaterThanOrEqual(48);
    expect(mobile.ctaLabelVisible).toBe(true);
  });
});
