'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const {
  API_BASE,
  middlewareUp,
  loginProviderViaApi,
  ownerCredentials
} = require('./provider-auth.cjs');

const db = require('../../database');

const LIVE_ACTIONS = process.env.PW_ALLOW_LIVE_ACTIONS === '1';
const TEST_PHONE = process.env.PW_TEST_PHONE || '';

const LIVE_CONTROL_IDS = new Set([
  'vaTestOutbound',
  'revPaySendBtn',
  'createApptBtn'
]);

/** Patient pay: #revPaySendBtn is disabled until a collection-queue row is selected or Patient ID + amount are entered. */

const SKIP_PATTERNS = [
  /logout/i,
  /delete account/i,
  /danger zone/i,
  /record payment/i,
  /send pay link/i
];

function createReport() {
  const base = (process.env.PW_API_BASE_URL || 'http://127.0.0.1:4001').replace(/\/$/, '');
  return {
    startedAt: new Date().toISOString(),
    base,
    account: ownerCredentials().email || 'provider@callsomo.com',
    liveActions: LIVE_ACTIONS,
    pages: [],
    results: [],
    summary: { pass: 0, fail: 0, skip: 0, pagesVisited: 0, controlsProbed: 0 }
  };
}

function recordResult(report, entry) {
  const row = {
    page: entry.page,
    control: entry.control,
    kind: entry.kind || 'button',
    status: entry.status,
    detail: entry.detail || '',
    screenshot: entry.screenshot || null
  };
  report.results.push(row);
  report.summary.controlsProbed += 1;
  if (entry.status === 'pass') report.summary.pass += 1;
  else if (entry.status === 'fail') report.summary.fail += 1;
  else report.summary.skip += 1;
}

async function ensureStandardProviderSession(page, request, context, existingCustomer = null) {
  let customer = existingCustomer;
  if (!customer) {
    customer = await loginProviderViaApi(request);
    if (!customer) {
      throw new Error(
        'Provider login failed — set PW_PROVIDER_EMAIL / PW_PROVIDER_PASS (default provider@callsomo.com / demo123)'
      );
    }
    const { cookies } = await request.storageState();
    if (context && cookies.length) {
      await context.addCookies(cookies);
    }
  }

  db.updateCustomer(customer.id, {
    voice_setup_completed_at: new Date().toISOString(),
    kelly_status: 'active',
    trial_status: customer.trial_status || 'active'
  });
  const fresh = db.getCustomer(customer.id) || customer;
  if (!fresh?.id) {
    throw new Error(`Provider customer not found in DB after login (id=${customer.id})`);
  }

  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.evaluate((c) => {
    sessionStorage.setItem('authenticated', 'true');
    sessionStorage.setItem('customer', JSON.stringify(c));
    sessionStorage.setItem(
      'user',
      JSON.stringify({
        name: c.name || c.company_name || 'Provider',
        role: c.role || 'Provider',
        ...c
      })
    );
  }, fresh);

  return fresh;
}

function runPreflightSeed() {
  const script = path.join(__dirname, '..', '..', 'scripts', 'enable-demo-provider-availability.js');
  let availability = { ok: true };
  try {
    execSync(`node "${script}"`, {
      cwd: path.join(__dirname, '..', '..'),
      stdio: 'pipe',
      encoding: 'utf8'
    });
  } catch (e) {
    availability = { ok: false, error: e.stderr || e.message };
  }

  let fhirPatient = { ok: true };
  try {
    const row = db.db.prepare('SELECT resource_id FROM fhir_patients WHERE is_deleted = 0 LIMIT 1').get();
    if (!row?.resource_id && db.createFHIRPatient) {
      const resourceId = 'Patient/audit-demo-001';
      db.createFHIRPatient({
        resourceType: 'Patient',
        id: resourceId,
        name: [{ given: ['Audit'], family: 'Demo' }],
        telecom: [
          { system: 'phone', value: '+15550100001' },
          { system: 'email', value: 'audit-demo@somo.test' }
        ]
      });
    }
  } catch (e) {
    fhirPatient = { ok: false, error: e.message };
  }

  return { ok: availability.ok && fhirPatient.ok, availability, fhirPatient };
}

async function collectInteractives(page) {
  return page.evaluate(() => {
    const isVisible = (el) => {
      const r = el.getBoundingClientRect();
      const s = window.getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
    };

    const selectors = [
      '#ppSidebarNav a.pp-nav-item',
      '#ppSidebarNav a',
      '[role="tab"]',
      '.pp-ptab',
      '.pp-revenue-tab',
      '.pp-btn',
      'button:not([type="hidden"])',
      'a.pp-btn',
      'input[type="submit"]'
    ];

    const seen = new Set();
    const items = [];

    for (const sel of selectors) {
      for (const el of document.querySelectorAll(sel)) {
        if (!isVisible(el)) continue;
        const id = el.id || '';
        const label = (
          el.innerText ||
          el.value ||
          el.getAttribute('aria-label') ||
          el.getAttribute('title') ||
          ''
        )
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 80);
        if (!label && !id) continue;
        const key = `${el.tagName}:${id}:${label}`;
        if (seen.has(key)) continue;
        seen.add(key);
        items.push({
          kind: el.tagName.toLowerCase() === 'a' ? 'link' : el.getAttribute('role') === 'tab' ? 'tab' : 'button',
          label,
          id,
          href: el.getAttribute('href') || '',
          disabled: !!el.disabled || el.getAttribute('aria-disabled') === 'true',
          selector: id ? `#${CSS.escape(id)}` : null
        });
      }
    }

    return items;
  });
}

function shouldSkipControl(control) {
  if (control.disabled) return 'disabled';
  if (control.href && control.href.startsWith('tel:')) return 'tel link';
  if (SKIP_PATTERNS.some((re) => re.test(control.label))) return 'destructive/skip pattern';
  if (LIVE_CONTROL_IDS.has(control.id) && !LIVE_ACTIONS) return 'live action (set PW_ALLOW_LIVE_ACTIONS=1)';
  if (control.id === 'vaTestOutbound' && LIVE_ACTIONS && !TEST_PHONE) {
    return 'live outbound (set PW_TEST_PHONE)';
  }
  if (control.id === 'joinBtn') return 'video join requires room token';
  return null;
}

function attachNetworkWatcher(page) {
  const apiErrors = [];
  const handler = (res) => {
    try {
      const url = res.url();
      if (!url.includes('/api/')) return;
      const status = res.status();
      if (status >= 400) {
        apiErrors.push({ url, status });
      }
    } catch (_) {}
  };
  page.on('response', handler);
  return {
    drain: () => {
      page.off('response', handler);
      return apiErrors.slice();
    },
    clear: () => {
      apiErrors.length = 0;
    }
  };
}

async function probeControl(page, pageId, control, opts = {}) {
  const skipReason = shouldSkipControl(control);
  if (skipReason) {
    return { status: 'skip', detail: skipReason };
  }

  const net = opts.netWatcher;
  if (net) net.clear();

  const pageErrors = [];
  const onError = (err) => pageErrors.push(String(err));
  page.on('pageerror', onError);

  const urlBefore = page.url();
  let locator;
  if (control.id) {
    locator = page.locator(`#${control.id}`);
  } else if (control.label) {
    locator = page.getByRole(control.kind === 'tab' ? 'tab' : 'button', {
      name: new RegExp(control.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
    }).first();
  } else {
    page.off('pageerror', onError);
    return { status: 'skip', detail: 'no selector' };
  }

  try {
    if (!(await locator.isVisible({ timeout: 2000 }).catch(() => false))) {
      page.off('pageerror', onError);
      return { status: 'skip', detail: 'not visible after wait' };
    }

    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(200);

    if (control.id === 'vaTestOutbound' && LIVE_ACTIONS && TEST_PHONE) {
      await page.fill('#vaTestOutboundPhone', TEST_PHONE);
    }

    await locator.click({ timeout: 5000 });
    await page.waitForTimeout(1500);

    const urlAfter = page.url();
    const apiErrors = net ? net.drain() : [];

    const domSignals = await page.evaluate(() => {
      const modalVisible = [...document.querySelectorAll('.details-panel, [role="dialog"], .modal')]
        .some((el) => {
          const s = window.getComputedStyle(el);
          return s.display !== 'none' && s.visibility !== 'hidden' && el.offsetParent !== null;
        });
      const errorToast = [...document.querySelectorAll('.va-toast, .pp-toast, [role="alert"]')]
        .filter((el) => !el.classList.contains('hidden'))
        .map((el) => (el.textContent || '').trim())
        .filter(Boolean);
      const loadFail = /could not load|failed to load|error loading/i.test(document.body.innerText || '');
      const tabSelected = document.querySelector('[role="tab"][aria-selected="true"]');
      return {
        modalVisible,
        errorToast,
        loadFail,
        tabSelected: tabSelected ? (tabSelected.innerText || '').trim() : null
      };
    });

    page.off('pageerror', onError);

    if (pageErrors.length) {
      return { status: 'fail', detail: `pageerror: ${pageErrors[0]}` };
    }
    const severeApi = apiErrors.filter((e) => e.status >= 500);
    if (severeApi.length) {
      return {
        status: 'fail',
        detail: `API ${severeApi[0].status}: ${severeApi[0].url}`
      };
    }
    if (domSignals.loadFail) {
      return { status: 'fail', detail: 'page shows load failure text' };
    }
    if (domSignals.errorToast.some((t) => /fail|error|could not/i.test(t))) {
      return { status: 'fail', detail: `toast: ${domSignals.errorToast[0]}` };
    }

    const clientApiErrors = apiErrors.filter((e) => e.status >= 400 && e.status < 500);
    if (control.id === 'vaTestOutbound' && clientApiErrors.length) {
      return {
        status: 'fail',
        detail: `API ${clientApiErrors[0].status}: ${clientApiErrors[0].url}`
      };
    }

    if (urlAfter !== urlBefore) {
      return { status: 'pass', detail: `navigated to ${urlAfter}` };
    }
    if (domSignals.modalVisible) {
      return { status: 'pass', detail: 'modal opened' };
    }
    if (control.kind === 'tab' || domSignals.tabSelected) {
      return { status: 'pass', detail: `tab active: ${domSignals.tabSelected || control.label}` };
    }
    if (control.id === 'vaTestOutbound' && LIVE_ACTIONS) {
      return { status: 'pass', detail: 'outbound test call requested' };
    }

    return { status: 'pass', detail: 'click accepted (no error)' };
  } catch (e) {
    page.off('pageerror', onError);
    return { status: 'fail', detail: e.message };
  }
}

async function auditPage(page, report, pageDef, opts = {}) {
  const entry = {
    id: pageDef.id,
    path: pageDef.path,
    title: '',
    shellOk: false,
    interactives: 0,
    error: null
  };

  const netWatcher = attachNetworkWatcher(page);

  try {
    const response = await page.goto(pageDef.path, {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });

    if (pageDef.expectRedirect) {
      const finalUrl = page.url();
      const ok = pageDef.expectRedirect.test(finalUrl);
      recordResult(report, {
        page: pageDef.id,
        control: 'legacy redirect',
        kind: 'navigation',
        status: ok ? 'pass' : 'fail',
        detail: finalUrl
      });
      entry.title = await page.title();
      report.pages.push(entry);
      return;
    }

    await page.waitForTimeout(pageDef.waitMs || 1500);
    entry.title = await page.title();

    if (pageDef.expectShell !== false) {
      const shell = await page.evaluate(() => ({
        nav: document.querySelectorAll('#ppSidebarNav a').length,
        portal: document.body.classList.contains('provider-portal')
      }));
      entry.shellOk = shell.nav >= 5 && shell.portal;
      recordResult(report, {
        page: pageDef.id,
        control: 'provider shell',
        kind: 'assertion',
        status: entry.shellOk ? 'pass' : 'fail',
        detail: `nav links=${shell.nav}, provider-portal=${shell.portal}`
      });
    }

    if (typeof pageDef.anchor === 'function') {
      await pageDef.anchor(page, report, recordResult);
    }

    const controls = await collectInteractives(page);
    const filtered = pageDef.stayOnPage
      ? controls.filter((c) => !c.href || !/\.html/.test(c.href) || c.id === 'ppSearchBtn' || c.id === 'ppNewApptBtn')
      : controls;
    entry.interactives = filtered.length;

    const maxProbes = pageDef.maxProbes || 15;
    for (const control of filtered.slice(0, maxProbes)) {
      if (opts.skipProbeIds?.has(control.id)) continue;
      const outcome = await probeControl(page, pageDef.id, control, { netWatcher });
      recordResult(report, {
        page: pageDef.id,
        control: control.label || control.id || 'control',
        kind: control.kind,
        status: outcome.status,
        detail: outcome.detail
      });

      if (outcome.status === 'fail' && opts.screenshotDir) {
        const shot = path.join(
          opts.screenshotDir,
          `${pageDef.id}-${(control.id || control.label).replace(/[^a-z0-9]+/gi, '-')}.png`
        );
        await page.screenshot({ path: shot, fullPage: false }).catch(() => {});
      }

      if (pageDef.path && !pageDef.stayOnPage && outcome.status === 'pass' && /navigated to/i.test(outcome.detail)) {
        await page.goto(pageDef.path, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(800);
      }
    }
  } catch (e) {
    entry.error = e.message;
    recordResult(report, {
      page: pageDef.id,
      control: 'page load',
      kind: 'navigation',
      status: 'fail',
      detail: e.message
    });
  } finally {
    netWatcher.drain();
  }

  report.pages.push(entry);
  report.summary.pagesVisited += 1;
}

function writeAuditReport(report) {
  const outDir = path.join(__dirname, '..', '..', 'test-results');
  fs.mkdirSync(outDir, { recursive: true });

  report.completedAt = new Date().toISOString();
  const jsonPath = path.join(outDir, 'tenant-front-desk-audit.json');
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));

  const works = report.results.filter((r) => r.status === 'pass');
  const broken = report.results.filter((r) => r.status === 'fail');
  const skipped = report.results.filter((r) => r.status === 'skip');

  const lines = [
    `# Tenant front desk audit — ${report.completedAt.slice(0, 10)}`,
    ``,
    `Account: ${report.account} | Base: ${report.base} | Live actions: ${report.liveActions ? 'yes' : 'no'}`,
    ``,
    `## Summary`,
    `- Pages visited: ${report.summary.pagesVisited}`,
    `- Controls probed: ${report.summary.controlsProbed}`,
    `- Pass: ${report.summary.pass} | Fail: ${report.summary.fail} | Skip: ${report.summary.skip}`,
    ``,
    `## Works`,
    `| Page | Control | Result |`,
    `|------|---------|--------|`
  ];

  for (const r of works) {
    lines.push(`| ${r.page} | ${r.control} | ${String(r.detail).replace(/\|/g, '/')} |`);
  }

  lines.push(``, `## Broken`, `| Page | Control | Error |`, `|------|---------|-------|`);
  for (const r of broken) {
    lines.push(`| ${r.page} | ${r.control} | ${String(r.detail).replace(/\|/g, '/')} |`);
  }

  lines.push(``, `## Skipped`, `| Page | Control | Reason |`, `|------|---------|--------|`);
  for (const r of skipped) {
    lines.push(`| ${r.page} | ${r.control} | ${String(r.detail).replace(/\|/g, '/')} |`);
  }

  const mdPath = path.join(outDir, 'tenant-front-desk-audit.md');
  fs.writeFileSync(mdPath, lines.join('\n'));

  return { jsonPath, mdPath };
}

const TENANT_PAGES = [
  { id: 'today', path: '/business/today.html', stayOnPage: true, maxProbes: 12 },
  { id: 'calendar', path: '/business/calendar.html', stayOnPage: true, maxProbes: 14 },
  { id: 'patients', path: '/business/patients.html', stayOnPage: true, maxProbes: 12 },
  {
    id: 'patient-case',
    path: '/business/patient-case.html',
    stayOnPage: true,
    maxProbes: 12,
    anchor: async (page, report, record) => {
      const pid = await page.evaluate(() => {
        const params = new URLSearchParams(window.location.search);
        return params.get('patient_id') || params.get('id') || '';
      });
      if (!pid) {
        record(report, {
          page: 'patient-case',
          control: 'load case (no patient_id)',
          kind: 'assertion',
          status: 'skip',
          detail: 'open with ?patient_id= from patients roster for full test'
        });
        return;
      }
      await page.fill('#patientIdInput', pid);
      await page.click('#loadCaseBtn');
      await page.waitForTimeout(1500);
      const failed = await page.evaluate(() =>
        /could not load|not found/i.test(document.body.innerText || '')
      );
      record(report, {
        page: 'patient-case',
        control: 'load case',
        kind: 'anchor',
        status: failed ? 'fail' : 'pass',
        detail: failed ? 'case load failed' : `loaded patient ${pid}`
      });
    }
  },
  { id: 'calls', path: '/business/calls.html', stayOnPage: true, maxProbes: 12 },
  { id: 'invoice-detail', path: '/business/invoice-detail.html?id=test-invoice', stayOnPage: true, maxProbes: 8 },
  { id: 'revenue-pipeline', path: '/business/revenue.html?tab=pipeline', stayOnPage: true, maxProbes: 15 },
  { id: 'revenue-claims', path: '/business/revenue.html?tab=claims', stayOnPage: true, maxProbes: 12 },
  { id: 'revenue-payments', path: '/business/revenue.html?tab=payments', stayOnPage: true, maxProbes: 15 },
  { id: 'revenue-work', path: '/business/revenue.html?tab=work', stayOnPage: true, maxProbes: 12 },
  { id: 'rcm-journey', path: '/business/rcm-journey.html', stayOnPage: true, maxProbes: 10 },
  { id: 'agent', path: '/business/agent.html', stayOnPage: true, maxProbes: 22 },
  { id: 'settings', path: '/business/settings.html', stayOnPage: true, maxProbes: 20 },
  { id: 'video-call', path: '/business/video-call.html', stayOnPage: true, maxProbes: 8 },
  { id: 'trial-activation', path: '/business/trial-activation.html', expectShell: false, maxProbes: 8 },
  {
    id: 'voice-setup-incomplete',
    path: '/business/voice-setup.html',
    expectShell: false,
    maxProbes: 10,
    setup: 'incompleteVoiceSetup'
  },
  {
    id: 'legacy-billing-claims',
    path: '/business/billing.html?section=claims',
    expectRedirect: /revenue\.html\?tab=claims/
  },
  {
    id: 'legacy-billing-overview',
    path: '/business/billing.html?section=overview',
    expectRedirect: /revenue\.html\?tab=pipeline/
  },
  { id: 'legacy-rcm', path: '/business/rcm.html', expectRedirect: /revenue\.html\?tab=pipeline/ },
  { id: 'legacy-claims', path: '/business/claims.html', expectRedirect: /revenue\.html\?tab=work/ }
];

module.exports = {
  API_BASE,
  LIVE_ACTIONS,
  TEST_PHONE,
  middlewareUp,
  createReport,
  recordResult,
  ensureStandardProviderSession,
  runPreflightSeed,
  collectInteractives,
  probeControl,
  auditPage,
  writeAuditReport,
  TENANT_PAGES
};
