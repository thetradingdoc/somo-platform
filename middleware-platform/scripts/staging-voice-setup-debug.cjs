#!/usr/bin/env node
'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { chromium } = require('playwright');

const UI = 'https://callsomo.com';
const API = 'https://api.callsomo.com';

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const login = await ctx.request.post(`${API}/api/customers/login`, {
    data: { email: process.env.SOMO_OWNER_EMAIL, password: process.env.SOMO_OWNER_PASSWORD, remember_me: true }
  });
  console.log('login', login.status());
  const state = await ctx.storageState();
  const ctx2 = await browser.newContext({ baseURL: UI, storageState: state });
  await ctx2.addInitScript((api) => {
    window.API_BASE = api;
    window.resolveApiBase = () => api;
  }, API);
  const loginBody = await login.json();
  const customer = loginBody.customer;
  const page = await ctx2.newPage();
  await page.addInitScript((c) => {
    sessionStorage.setItem('authenticated', 'true');
    sessionStorage.setItem('customer', JSON.stringify(c));
  }, customer);
  page.on('console', (m) => console.log('console:', m.type(), m.text()));
  page.on('response', (r) => {
    if (r.url().includes('/api/voice-agent')) console.log('resp', r.status(), r.url());
  });
  await page.goto(`${UI}/business/voice-setup.html`);
  console.log('url', page.url());
  await page.waitForTimeout(2000);
  const err = await page.locator('#setupError').textContent().catch(() => '');
  console.log('setupError', err || '(hidden)');
  console.log('VoiceHoursPicker', await page.evaluate(() => typeof VoiceHoursPicker));
  console.log('VoiceAgentPage', await page.evaluate(() => typeof VoiceAgentPage));
  await page.locator('#setupGreeting').fill('Debug greeting');
  await page.locator('#setupNext1').click();
  await page.waitForTimeout(5000);
  console.log('title after click', await page.locator('#setupTitle').textContent());
  console.log('setupError after', await page.locator('#setupError').textContent().catch(() => ''));
  await browser.close();
})();
