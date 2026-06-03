'use strict';

const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

const API_BASE = (process.env.PW_API_BASE_URL || 'http://127.0.0.1:4000').replace(/\/$/, '');
const EMAIL = process.env.PW_PROVIDER_EMAIL || 'provider@callsomo.com';
const PASS = process.env.PW_PROVIDER_PASS || 'demo123';
const ARTIFACT_DIR = path.join(__dirname, '..', 'e2e-artifacts', 'provider-portal');

const SHOTS = [
  { name: 'today-desktop', path: '/business/today.html', width: 1440, height: 960 },
  { name: 'today-mobile', path: '/business/today.html', width: 390, height: 844 },
  { name: 'calendar-desktop', path: '/business/calendar.html', width: 1440, height: 960 },
  { name: 'agent-desktop', path: '/business/agent.html', width: 1440, height: 960 },
  { name: 'revenue-pipeline-desktop', path: '/business/revenue.html?tab=pipeline', width: 1440, height: 960 },
  { name: 'revenue-claims-desktop', path: '/business/revenue.html?tab=claims', width: 1440, height: 960 },
  { name: 'revenue-payments-desktop', path: '/business/revenue.html?tab=payments', width: 1440, height: 960 },
  { name: 'claims-desktop', path: '/business/revenue.html?tab=work', width: 1440, height: 960 },
  { name: 'settings-desktop', path: '/business/settings.html', width: 1440, height: 960 },
];

test.describe('Provider portal screenshots', () => {
  test.beforeAll(async ({ request }) => {
    try {
      if (!(await request.get(`${API_BASE}/health`)).ok()) test.skip(true, 'no server');
    } catch {
      test.skip(true, 'no server');
    }
    fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  });

  for (const shot of SHOTS) {
    test(shot.name, async ({ page, request }) => {
      const login = await request.post(`${API_BASE}/api/customers/login`, {
        data: { email: EMAIL, password: PASS, remember_me: false },
      });
      const customer = (await login.json()).customer || {};
      await page.goto(`${API_BASE}/login`, { waitUntil: 'domcontentloaded' });
      await page.evaluate((c) => {
        sessionStorage.setItem('authenticated', 'true');
        sessionStorage.setItem('customer', JSON.stringify(c));
        sessionStorage.setItem('user', JSON.stringify({ name: c.name || 'Provider', role: c.role || 'Provider', ...c }));
      }, customer);
      await page.setViewportSize({ width: shot.width, height: shot.height });
      await page.goto(`${API_BASE}${shot.path}`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(800);
      await page.screenshot({ path: path.join(ARTIFACT_DIR, `${shot.name}.png`), fullPage: true });
      expect(fs.existsSync(path.join(ARTIFACT_DIR, `${shot.name}.png`))).toBeTruthy();
    });
  }
});
