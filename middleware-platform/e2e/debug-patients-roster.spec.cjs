'use strict';

const { test, expect } = require('@playwright/test');

const API_BASE = (process.env.PW_API_BASE_URL || 'http://127.0.0.1:4000').replace(/\/$/, '');
const EMAIL = process.env.PW_PROVIDER_EMAIL || 'provider@callsomo.com';
const PASS = process.env.PW_PROVIDER_PASS || 'demo123';

test('debug patients roster load', async ({ page, request, context }) => {
  const login = await request.post(`${API_BASE}/api/customers/login`, {
    data: { email: EMAIL, password: PASS, remember_me: true },
  });
  expect(login.ok()).toBeTruthy();
  const json = await login.json();
  const customer = json.customer || {};
  const { cookies } = await request.storageState();
  await context.addCookies(cookies);

  const consoleLogs = [];
  page.on('console', (msg) => consoleLogs.push(`[${msg.type()}] ${msg.text()}`));

  const fhirResponses = [];
  page.on('response', async (res) => {
    const url = res.url();
    if (url.includes('/fhir/Patient') || url.includes('/api/admin/appointments')) {
      let bodyPreview = '';
      try {
        const t = await res.text();
        bodyPreview = t.slice(0, 120);
      } catch (_) {}
      fhirResponses.push({ url, status: res.status(), ct: res.headers()['content-type'], bodyPreview });
    }
  });

  await page.goto(`${API_BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.evaluate((c) => {
    sessionStorage.setItem('authenticated', 'true');
    sessionStorage.setItem('customer', JSON.stringify(c));
    sessionStorage.setItem('user', JSON.stringify({ name: c.name || 'Provider', role: c.role || 'Provider', ...c }));
  }, customer);

  await page.goto(`${API_BASE}/business/patients.html`, { waitUntil: 'networkidle', timeout: 60_000 });

  const snap = await page.evaluate(() => {
    const api = window.API_BASE;
    return {
      api,
      build: document.documentElement.dataset.patientsBuild,
      page: window.__patientsPage?.snapshot?.(),
      customers: window.__patientsPage?.getAllCustomers?.()?.length,
      gridHtml: document.getElementById('patientsRosterGrid')?.innerHTML?.slice(0, 200),
      kpi: document.querySelector('#patientsKpiRow .pp-kpi-val')?.textContent,
    };
  });

  // eslint-disable-next-line no-console
  console.log('SNAP', JSON.stringify(snap, null, 2));
  // eslint-disable-next-line no-console
  console.log('FHIR/Appt responses', JSON.stringify(fhirResponses, null, 2));
  // eslint-disable-next-line no-console
  console.log('Console [patients]', consoleLogs.filter((l) => l.includes('patients')).join('\n'));

  expect(snap.customers, `patients console: ${consoleLogs.join('; ')}`).toBeGreaterThan(0);
});
