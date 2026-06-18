'use strict';

const {
  API_BASE,
  middlewareUp,
  loginProviderViaApi,
  ownerCredentials,
  ensureAuthenticatedCustomer
} = require('../../helpers/provider-auth.cjs');
const sel = require('./portal-selectors.cjs');

/**
 * Real UI login — fills login form and waits for redirect (no sessionStorage injection).
 */
async function loginViaUi(page, request, { email, password } = {}) {
  const creds = ownerCredentials();
  const userEmail = email || creds.email;
  const userPass = password || creds.password;

  const pre = await request.post(`${API_BASE}/api/customers/login`, {
    data: { email: userEmail, password: userPass, remember_me: true }
  });
  if (!pre.ok()) {
    throw new Error(`API login failed for ${userEmail}: ${pre.status()}`);
  }

  const { cookies } = await request.storageState();
  if (cookies.length) {
    await page.context().addCookies(cookies);
  }

  await page.goto(`${API_BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.locator(sel.loginEmail).fill(userEmail);
  await page.locator(sel.loginPassword).fill(userPass);
  await page.locator(sel.loginSubmit).click();

  await page.waitForURL(/\/business\/today\.html/, { timeout: 30_000 });
  await page.locator('#ppSidebarNav').waitFor({ state: 'visible', timeout: 15_000 });
  return pre.json().then((b) => b.customer);
}

/**
 * Navigate to provider page after UI login.
 */
async function gotoProviderPage(page, path) {
  const base = API_BASE.replace(/\/$/, '');
  const href = path.startsWith('/') ? path : `/business/${path}`;
  await page.goto(`${base}${href}`, { waitUntil: 'domcontentloaded' });
  await page.locator('#ppSidebarNav').waitFor({ state: 'visible', timeout: 15_000 });
}

module.exports = {
  API_BASE,
  middlewareUp,
  loginViaUi,
  gotoProviderPage,
  loginProviderViaApi,
  ownerCredentials,
  ensureAuthenticatedCustomer,
  sel
};
