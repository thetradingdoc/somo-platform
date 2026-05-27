#!/usr/bin/env node
'use strict';

/**
 * Inventory provider portal sidebar nav, in-page tabs, and buttons.
 * Usage: PW_API_BASE_URL=http://127.0.0.1:4000 node scripts/playwright-provider-portal-inventory.cjs
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = (process.env.PW_API_BASE_URL || 'http://127.0.0.1:4000').replace(/\/$/, '');
const EMAIL = process.env.PW_PROVIDER_EMAIL || 'provider@doclittle.com';
const PASS = process.env.PW_PROVIDER_PASS || 'demo123';

const PAGES = [
  { id: 'today', path: '/business/today.html' },
  { id: 'calendar', path: '/business/calendar.html' },
  { id: 'patients', path: '/business/patients.html' },
  { id: 'billing-overview', path: '/business/billing.html?section=overview' },
  { id: 'billing-claims', path: '/business/billing.html?section=claims' },
  { id: 'billing-invoices', path: '/business/billing.html?section=invoices' },
  { id: 'claims', path: '/business/claims.html' },
  { id: 'agent', path: '/business/agent.html' },
  { id: 'settings', path: '/business/settings.html' },
  { id: 'wallets', path: '/business/wallets.html' },
  { id: 'video', path: '/business/video-call.html' }
];

function visibleText(el) {
  return (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
}

async function collectInteractive(page) {
  return page.evaluate(() => {
    const isVisible = (el) => {
      const r = el.getBoundingClientRect();
      const s = window.getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
    };
    const nav = [...document.querySelectorAll('.pp-sb-nav a, #ppSidebarNav a, nav a[href*="business"]')]
      .filter(isVisible)
      .map((a) => ({
        kind: 'sidebar-nav',
        label: (a.innerText || '').replace(/\s+/g, ' ').trim(),
        href: a.getAttribute('href') || ''
      }));

    const tabs = [...document.querySelectorAll(
      '.pp-panel-tabs button, .pp-panel-tabs a, [role="tab"], .tab-btn, .nav-tab, .billing-tab, .section-tab'
    )]
      .filter(isVisible)
      .map((el) => ({
        kind: 'tab',
        label: (el.innerText || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim(),
        id: el.id || '',
        href: el.getAttribute('href') || ''
      }));

    const buttons = [...document.querySelectorAll('button, a.pp-btn, input[type="submit"]')]
      .filter(isVisible)
      .map((el) => ({
        kind: el.tagName.toLowerCase() === 'a' ? 'link-button' : 'button',
        label: (el.innerText || el.value || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 80),
        id: el.id || '',
        href: el.getAttribute('href') || ''
      }))
      .filter((b) => b.label);

    const legacyNav = [...document.querySelectorAll('#sidebarNav a, .sidebar-nav a, .nav-item a')]
      .filter(isVisible)
      .map((a) => ({
        kind: 'legacy-nav',
        label: (a.innerText || '').replace(/\s+/g, ' ').trim(),
        href: a.getAttribute('href') || ''
      }));

    return { nav, tabs, buttons, legacyNav };
  });
}

async function login(page) {
  const res = await page.request.post(`${BASE}/api/customers/login`, {
    data: { email: EMAIL, password: PASS, remember_me: false }
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok() || !json.success) {
    throw new Error(json.error || json.message || `Login HTTP ${res.status()}`);
  }
  const customer = json.customer || {};
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.evaluate((c) => {
    sessionStorage.setItem('authenticated', 'true');
    sessionStorage.setItem('customer', JSON.stringify(c));
    sessionStorage.setItem('user', JSON.stringify({
      name: c.name || c.company_name || 'User',
      role: c.role || 'Provider',
      ...c
    }));
  }, customer);
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ baseURL: BASE });
  const page = await context.newPage();

  const report = {
    base: BASE,
    login: { email: EMAIL, ok: false },
    sidebarFromToday: null,
    pages: []
  };

  try {
    await login(page);
    report.login.ok = true;
    report.login.customer = (await page.evaluate(() => {
      try { return JSON.parse(sessionStorage.getItem('customer') || '{}').email; } catch { return null; }
    })) || EMAIL;

    await page.goto(`${BASE}/business/today.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);
    const today = await collectInteractive(page);
    report.sidebarFromToday = {
      nav: today.nav,
      legacyNav: today.legacyNav
    };

    for (const p of PAGES) {
      const entry = { id: p.id, url: `${BASE}${p.path}`, error: null, nav: [], tabs: [], buttons: [] };
      try {
        await page.goto(`${BASE}${p.path}`, { waitUntil: 'domcontentloaded', timeout: 25000 });
        await page.waitForTimeout(1200);
        const data = await collectInteractive(page);
        entry.nav = data.nav;
        entry.tabs = data.tabs;
        entry.buttons = data.buttons.slice(0, 40);
        entry.legacyNav = data.legacyNav;
        entry.title = await page.title();
        entry.hasProviderPortal = await page.evaluate(() => document.body.classList.contains('provider-portal'));
      } catch (e) {
        entry.error = e.message;
      }
      report.pages.push(entry);
    }
  } catch (e) {
    report.fatal = e.message;
  } finally {
    await browser.close();
  }

  const outPath = path.join(__dirname, '..', 'playwright-provider-portal-inventory.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

  console.log('\n=== PROVIDER PORTAL INVENTORY ===\n');
  console.log('Login:', report.login.ok ? 'OK' : 'FAILED', '→', report.login.ok ? 'session established' : report.fatal || 'check server');
  console.log('\n--- Sidebar (from today.html) ---');
  for (const n of report.sidebarFromToday?.nav || []) {
    console.log(`  [nav] ${n.label} → ${n.href}`);
  }
  if (report.sidebarFromToday?.legacyNav?.length) {
    console.log('\n--- Legacy sidebar (config.js, not provider-shell) ---');
    for (const n of report.sidebarFromToday.legacyNav) {
      console.log(`  [legacy] ${n.label} → ${n.href}`);
    }
  }

  for (const p of report.pages) {
    console.log(`\n--- ${p.id} (${p.path || p.url}) ---`);
    if (p.error) {
      console.log('  ERROR:', p.error);
      continue;
    }
    console.log(`  title: ${p.title}`);
    console.log(`  provider-portal class: ${p.hasProviderPortal}`);
    if (p.tabs?.length) {
      console.log('  Tabs:');
      for (const t of p.tabs) console.log(`    · ${t.label}${t.id ? ` #${t.id}` : ''}`);
    }
    if (p.buttons?.length) {
      console.log('  Buttons/links (sample):');
      for (const b of p.buttons.slice(0, 15)) {
        console.log(`    · [${b.kind}] ${b.label}${b.href ? ` → ${b.href}` : ''}`);
      }
      if (p.buttons.length > 15) console.log(`    … +${p.buttons.length - 15} more`);
    }
  }

  console.log(`\nFull JSON: ${outPath}\n`);
  process.exit(report.login.ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
