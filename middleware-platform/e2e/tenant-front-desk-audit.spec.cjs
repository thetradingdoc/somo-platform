'use strict';

const path = require('path');
const { test, expect } = require('@playwright/test');
const db = require('../database');
const {
  middlewareUp,
  createReport,
  recordResult,
  ensureStandardProviderSession,
  runPreflightSeed,
  auditPage,
  writeAuditReport,
  TENANT_PAGES,
  LIVE_ACTIONS,
  TEST_PHONE
} = require('./helpers/tenant-ui-audit.cjs');

const SCREENSHOT_DIR = path.join(__dirname, '..', 'test-results', 'tenant-audit-screenshots');

/** @type {ReturnType<createReport>} */
let report;
let providerCustomer = null;

test.describe('Tenant front desk UI audit', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async ({ request }) => {
    if (!(await middlewareUp(request))) {
      test.skip(true, 'Audit middleware not running (expected http://127.0.0.1:4001 via webServer)');
    }

    report = createReport();
    const seed = runPreflightSeed();
    report.preflightSeed = seed;

    const loginCheck = await request.post('/api/customers/login', {
      data: {
        email: process.env.PW_PROVIDER_EMAIL || 'provider@callsomo.com',
        password: process.env.PW_PROVIDER_PASS || process.env.PW_PROVIDER_PASSWORD || 'demo123',
        remember_me: true
      }
    });
    if (!loginCheck.ok()) {
      test.skip(true, 'Provider login failed — run npm run seed:demo or set PW_PROVIDER_*');
    }
  });

  test.afterAll(async () => {
    if (!report) return;
    const { jsonPath, mdPath } = writeAuditReport(report);
    console.log(`\nAudit JSON: ${jsonPath}`);
    console.log(`Audit Markdown: ${mdPath}`);
    console.log(
      `Summary: pass=${report.summary.pass} fail=${report.summary.fail} skip=${report.summary.skip}`
    );
    if (report.summary.fail > 0) {
      console.warn(`Audit recorded ${report.summary.fail} broken control(s) — see ${mdPath}`);
    }
  });

  test('authenticate standard SaaS provider', async ({ page, request, context }) => {
    providerCustomer = await ensureStandardProviderSession(page, request, context);
    expect(providerCustomer?.id).toBeTruthy();
    recordResult(report, {
      page: 'auth',
      control: 'provider login',
      kind: 'setup',
      status: 'pass',
      detail: providerCustomer.email
    });
  });

  for (const pageDef of TENANT_PAGES) {
    test(`audit ${pageDef.id}`, async ({ page, request, context }) => {
      if (!providerCustomer) {
        providerCustomer = await ensureStandardProviderSession(page, request, context);
      } else {
        await ensureStandardProviderSession(page, request, context);
      }

      if (pageDef.setup === 'incompleteVoiceSetup') {
        db.updateCustomer(providerCustomer.id, { voice_setup_completed_at: null });
        await page.evaluate((c) => {
          const stored = JSON.parse(sessionStorage.getItem('customer') || '{}');
          sessionStorage.setItem(
            'customer',
            JSON.stringify({ ...stored, voice_setup_completed_at: null })
          );
        }, providerCustomer);
      } else {
        db.updateCustomer(providerCustomer.id, {
          voice_setup_completed_at: new Date().toISOString(),
          kelly_status: 'active'
        });
      }

      if (pageDef.id === 'patient-case') {
        const row = db.db.prepare('SELECT resource_id FROM fhir_patients WHERE is_deleted = 0 LIMIT 1').get();
        const patientId = row?.resource_id;
        if (patientId) {
          pageDef.path = `/business/patient-case.html?patient_id=${encodeURIComponent(patientId)}`;
        }
      }

      if (pageDef.id === 'agent' || pageDef.id === 'settings') {
        await page.route('**/api/voice-agent/onboarding**', async (route) => {
          if (route.request().method() === 'GET') {
            return route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify({
                success: true,
                onboarding_state: 'voice_setup_complete',
                destination: { path: '/business/agent.html' }
              })
            });
          }
          return route.continue();
        });
      }

      await auditPage(page, report, pageDef, {
        screenshotDir: SCREENSHOT_DIR,
        skipProbeIds: new Set(['ppMobileToggle'])
      });

      if (pageDef.setup === 'incompleteVoiceSetup') {
        const stepVisible = await page.locator('#setupGreeting, #setupTitle').first().isVisible().catch(() => false);
        recordResult(report, {
          page: pageDef.id,
          control: 'voice setup step 1',
          kind: 'anchor',
          status: stepVisible ? 'pass' : 'fail',
          detail: stepVisible ? 'setup wizard visible' : 'setup wizard not shown'
        });
        db.updateCustomer(providerCustomer.id, {
          voice_setup_completed_at: new Date().toISOString()
        });
      }

      if (pageDef.id === 'today') {
        await page.goto('/business/today.html', { waitUntil: 'domcontentloaded' });
        await page.click('#ppNewApptBtn');
        await page.waitForTimeout(800);
        const onCalendar = /calendar\.html/i.test(page.url());
        recordResult(report, {
          page: 'today',
          control: 'New appointment anchor',
          kind: 'anchor',
          status: onCalendar ? 'pass' : 'fail',
          detail: page.url()
        });
      }

      if (pageDef.id === 'calendar') {
        await page.goto('/business/calendar.html', { waitUntil: 'domcontentloaded' });
        await page.click('#createApptBtn');
        await page.waitForTimeout(500);
        const modalOpen = await page.locator('#createApptModal').isVisible();
        recordResult(report, {
          page: 'calendar',
          control: 'Create appointment modal anchor',
          kind: 'anchor',
          status: modalOpen ? 'pass' : 'fail',
          detail: modalOpen ? 'modal visible' : 'modal hidden'
        });
        if (modalOpen) {
          await page.keyboard.press('Escape');
          await page.waitForTimeout(300);
        }
      }

      if (pageDef.id === 'revenue-payments') {
        await page.goto('/business/revenue.html?tab=payments', { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#revPaySendBtn', { state: 'visible', timeout: 15000 }).catch(() => {});
        const visible = await page.locator('#revPaySendBtn').isVisible().catch(() => false);
        const balanceRow = page.locator('[data-balance-row]').first();
        if (await balanceRow.isVisible().catch(() => false)) {
          await balanceRow.click();
          await page.waitForTimeout(200);
        }
        const enabled = await page.locator('#revPaySendBtn').isEnabled().catch(() => false);
        const manualReady = await page.evaluate(() => {
          const pid = document.getElementById('revPayPatientId');
          const amt = document.getElementById('revPayAmount');
          if (pid) pid.value = 'Patient/test';
          if (amt) amt.value = '25';
          pid?.dispatchEvent(new Event('input', { bubbles: true }));
          amt?.dispatchEvent(new Event('input', { bubbles: true }));
          const btn = document.getElementById('revPaySendBtn');
          return btn ? !btn.disabled : false;
        }).catch(() => false);
        recordResult(report, {
          page: 'revenue-payments',
          control: 'Patient pay send button visible',
          kind: 'anchor',
          status: visible && (enabled || manualReady) ? 'pass' : 'fail',
          detail: visible
            ? enabled
              ? 'revPaySendBtn enabled after balance row select'
              : manualReady
                ? 'revPaySendBtn enabled after manual Patient ID + amount'
                : 'revPaySendBtn visible but disabled — select balance or enter fields'
            : 'revPaySendBtn not visible after tab mount'
        });
      }

      if (pageDef.id === 'agent' && LIVE_ACTIONS && TEST_PHONE) {
        await page.goto('/business/agent.html', { waitUntil: 'domcontentloaded' });
        await page.fill('#vaTestOutboundPhone', TEST_PHONE);
        const [resp] = await Promise.all([
          page.waitForResponse((r) => r.url().includes('/api/voice/outbound/call'), { timeout: 15000 }).catch(() => null),
          page.click('#vaTestOutbound')
        ]);
        const status = resp ? resp.status() : 0;
        recordResult(report, {
          page: 'agent',
          control: 'Live outbound test call',
          kind: 'anchor',
          status: resp && resp.ok() ? 'pass' : 'fail',
          detail: resp ? `HTTP ${status}` : 'no API response'
        });
      } else if (pageDef.id === 'agent') {
        recordResult(report, {
          page: 'agent',
          control: 'Live outbound test call',
          kind: 'anchor',
          status: 'skip',
          detail: LIVE_ACTIONS ? 'set PW_TEST_PHONE' : 'set PW_ALLOW_LIVE_ACTIONS=1'
        });
      }

      if (pageDef.id === 'settings') {
        for (const tab of ['Profile', 'Integrations', 'Voice Agent', 'Billing', 'Advanced']) {
          await page.getByRole('tab', { name: tab }).click();
          await page.waitForTimeout(400);
          const selected = await page.getByRole('tab', { name: tab }).getAttribute('aria-selected');
          recordResult(report, {
            page: 'settings',
            control: `${tab} tab anchor`,
            kind: 'anchor',
            status: selected === 'true' ? 'pass' : 'fail',
            detail: `aria-selected=${selected}`
          });
        }
        const outboundSummary = await page.locator('#vaSettingsOutboundSummary').textContent().catch(() => '');
        recordResult(report, {
          page: 'settings',
          control: 'Outbound opener summary',
          kind: 'anchor',
          status: outboundSummary && outboundSummary !== '—' ? 'pass' : 'fail',
          detail: outboundSummary || 'empty'
        });
      }
    });
  }
});
