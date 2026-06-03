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
const EMAIL = process.env.PW_PROVIDER_EMAIL || 'provider@callsomo.com';
const PASS = process.env.PW_PROVIDER_PASS || 'demo123';

const businessDir = path.join(__dirname, '..', '..', 'unified-dashboard', 'business');
const ALL_HTML = fs.readdirSync(businessDir).filter((f) => f.endsWith('.html'));

const CORE_PAGES = [
  { id: 'today', path: '/business/today.html', expectNav: 6 },
  { id: 'calendar', path: '/business/calendar.html', expectNav: 6 },
  { id: 'patients', path: '/business/patients.html', expectNav: 6 },
  { id: 'patient-case', path: '/business/patient-case.html', expectNav: 6 },
  { id: 'revenue-pipeline', path: '/business/revenue.html?tab=pipeline', expectNav: 6 },
  { id: 'revenue-claims', path: '/business/revenue.html?tab=claims', expectNav: 6 },
  { id: 'revenue-payments', path: '/business/revenue.html?tab=payments', expectNav: 6 },
  { id: 'revenue-work', path: '/business/revenue.html?tab=work', expectNav: 6 },
  { id: 'rcm-journey', path: '/business/rcm-journey.html', expectNav: 6 },
  { id: 'agent', path: '/business/agent.html', expectNav: 6 },
  { id: 'settings', path: '/business/settings.html', expectNav: 6 },
  { id: 'video', path: '/business/video-call.html', expectNav: 6 },
  { id: 'invoice-detail', path: '/business/invoice-detail.html', expectNav: 6 },
  { id: 'payor-review', path: '/business/payor-review.html', expectNav: 6 },
  { id: 'merge-review', path: '/business/merge-review.html', expectNav: 6 },
  { id: 'feature-flags', path: '/business/feature-flags.html', expectNav: 6 }
];
const covered = new Set(CORE_PAGES.map((p) => p.path.split('?')[0].split('/').pop()));
const PAGES = CORE_PAGES.concat(
  ALL_HTML.filter((f) => !covered.has(f)).map((f) => ({
    id: f.replace('.html', ''),
    path: `/business/${f}`,
    expectNav: 0,
    legacyOnly: true
  }))
);

async function collectInteractive(page) {
  return page.evaluate(() => {
    const isVisible = (el) => {
      const r = el.getBoundingClientRect();
      const s = window.getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
    };
    const nav = [...document.querySelectorAll('#ppSidebarNav a.pp-nav-item, #ppSidebarNav a')]
      .filter(isVisible)
      .map((a) => ({
        kind: 'sidebar-nav',
        label: (a.innerText || '').replace(/\s+/g, ' ').trim(),
        href: a.getAttribute('href') || ''
      }));

    const tabs = [...document.querySelectorAll(
      '.pp-panel-tabs button, .pp-panel-tabs a, [role="tab"], .tab-btn, .nav-tab, .billing-tab, .section-tab, .settings-tab-btn, #billingSectionTabs .pp-ptab'
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

    const legacyNav = [...document.querySelectorAll('#sidebarNav a, .sidebar-nav a, .sidebar .nav-item a')]
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
    pages: [],
    checks: {
      noHangingLoading: [],
      shellAssertions: []
    },
    failures: []
  };

  try {
    await login(page);
    report.login.ok = true;

    await page.goto(`${BASE}/business/today.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);
    const today = await collectInteractive(page);
    report.sidebarFromToday = { nav: today.nav, legacyNav: today.legacyNav };

    const kellyOnToday = await page.evaluate(() => !!document.getElementById('ppKellyLive'));
    if (!kellyOnToday) report.failures.push('today: missing #ppKellyLive');

    for (const p of PAGES) {
      const entry = { id: p.id, url: `${BASE}${p.path}`, error: null, nav: [], tabs: [], buttons: [] };
      try {
        if (p.legacyOnly) {
          const resp = await page.goto(`${BASE}${p.path}`, { waitUntil: 'domcontentloaded', timeout: 15000 });
          entry.redirected = resp.url();
          entry.legacyOnly = true;
          report.pages.push(entry);
          continue;
        }
        await page.goto(`${BASE}${p.path}`, { waitUntil: 'domcontentloaded', timeout: 25000 });
        await page.waitForTimeout(1500);
        const data = await collectInteractive(page);
        entry.nav = data.nav;
        entry.tabs = data.tabs;
        entry.buttons = data.buttons.slice(0, 40);
        entry.legacyNav = data.legacyNav;
        entry.title = await page.title();
        entry.hasProviderPortal = await page.evaluate(() => document.body.classList.contains('provider-portal'));
        entry.shell = await page.evaluate(() => ({
          ppSidebarNavLinks: document.querySelectorAll('#ppSidebarNav a').length,
          kellyLive: !!document.getElementById('ppKellyLive'),
          legacySidebarNavLinks: document.querySelectorAll('#sidebarNav a, .sidebar .nav-item a').length
        }));
        entry.hangingLoading = await page.evaluate(() => {
          const blocked = ['Loading...', 'Loading…'];
          const nodes = Array.from(document.querySelectorAll('.pp-panel-body, .pp-panel-sub'));
          return nodes.some((el) => {
            const t = (el.textContent || '').trim();
            return blocked.some((token) => t === token);
          });
        });
        report.checks.noHangingLoading.push({ page: p.id, ok: !entry.hangingLoading });

        const minNav = p.expectNav || 0;
        if (minNav > 0 && entry.shell.ppSidebarNavLinks < minNav) {
          report.failures.push(`${p.id}: nav links ${entry.shell.ppSidebarNavLinks} < ${minNav}`);
        }
        if (minNav > 0 && !entry.shell.kellyLive) {
          report.failures.push(`${p.id}: missing Kelly widget`);
        }
        if (minNav > 0 && entry.legacyNav.length > 0) {
          report.failures.push(`${p.id}: legacy nav visible (${entry.legacyNav.length})`);
        }
        if (p.expectNav > 0 && entry.title && !entry.title.includes('Somo Provider')) {
          report.failures.push(`${p.id}: title not Somo Provider pattern: ${entry.title}`);
        }
      } catch (e) {
        entry.error = e.message;
        report.failures.push(`${p.id}: ${e.message}`);
      }
      report.pages.push(entry);
    }
  } catch (e) {
    report.fatal = e.message;
    report.failures.push(`fatal: ${e.message}`);
  } finally {
    await browser.close();
  }

  const outPath = path.join(__dirname, '..', 'playwright-provider-portal-inventory.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

  console.log('\n=== PROVIDER PORTAL INVENTORY ===\n');
  console.log('Login:', report.login.ok ? 'OK' : 'FAILED');
  if (report.failures.length) {
    console.log('\nFailures:');
    for (const f of report.failures) console.log('  -', f);
  }
  console.log(`\nFull JSON: ${outPath}\n`);
  process.exit(report.login.ok && report.failures.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
