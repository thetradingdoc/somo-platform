#!/usr/bin/env node
'use strict';

/**
 * CR-047 — Provider portal prod smoke (login → Today → Kelly panel).
 *
 * Usage:
 *   PW_PROVIDER_EMAIL=... PW_PROVIDER_PASSWORD=... node scripts/provider-portal-journey-prod.cjs
 *   npm run test:prod:provider-portal
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

function loadCredentials() {
  const fromEnv = {
    email: (process.env.PW_PROVIDER_EMAIL || process.env.SOMO_OWNER_EMAIL || '').trim(),
    password: process.env.PW_PROVIDER_PASSWORD || process.env.PW_PROVIDER_PASS || process.env.SOMO_OWNER_PASSWORD || '',
  };
  if (fromEnv.email && fromEnv.password) return fromEnv;

  const credPath = path.join(__dirname, '..', '..', 'local', 'provider-login.credentials');
  if (!fs.existsSync(credPath)) return fromEnv;
  const out = { ...fromEnv };
  for (const line of fs.readFileSync(credPath, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq <= 0) continue;
    const key = t.slice(0, eq).trim();
    const val = t.slice(eq + 1).trim();
    if (key === 'email' && !out.email) out.email = val;
    if (key === 'password' && !out.password) out.password = val;
  }
  return out;
}

const BASE = (
  process.env.PROVIDER_PORTAL_BASE_URL ||
  process.env.PW_BASE_URL ||
  'https://callsomo.com'
).replace(/\/$/, '');
const creds = loadCredentials();
const EMAIL = creds.email;
const PASS = creds.password;

async function main() {
  if (!EMAIL || !PASS) {
    console.log(
      JSON.stringify({
        skipped: true,
        reason: 'Set PW_PROVIDER_EMAIL/PW_PROVIDER_PASSWORD or local/provider-login.credentials',
      })
    );
    process.exit(0);
  }

  const browser = await chromium.launch({ headless: process.env.HEADFUL !== '1' });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();

  try {
    await page.goto(`${BASE}/login.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.fill('#loginEmail', EMAIL);
    await page.fill('#loginPassword', PASS);
    await page.click('#loginSubmit');

    await page.waitForURL(/\/business\/today\.html/, { timeout: 60000 });

    const kellyLive = page.locator('#ppKellyLive');
    await kellyLive.waitFor({ state: 'visible', timeout: 30000 });

    const label = await page.locator('#ppKellyLabel').innerText();
    if (!/Somo|Kelly/i.test(label)) {
      throw new Error(`Unexpected Kelly label: ${label}`);
    }

    const signOut = page.locator('[data-testid="provider-sign-out"], #ppSignOut, a[href*="logout"]');
    if ((await signOut.count()) > 0) {
      await signOut.first().click();
    }

    console.log(
      JSON.stringify({
        passed: true,
        base: BASE,
        url: page.url(),
        kelly_label: label.trim(),
      })
    );
    process.exit(0);
  } catch (e) {
    console.error(
      JSON.stringify({
        passed: false,
        base: BASE,
        error: e.message,
        url: page.url(),
      })
    );
    process.exit(1);
  } finally {
    await browser.close();
  }
}

main();
