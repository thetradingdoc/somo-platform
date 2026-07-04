'use strict';

const { expect } = require('@playwright/test');
const path = require('path');

const root = path.join(__dirname, '..', '..', '..');
const apiBase = (process.env.PW_API_BASE_URL || '').replace(/\/$/, '');
process.env.DB_PATH =
  apiBase.includes(':4001') || process.env.AUDIT_MIDDLEWARE === '1'
    ? path.join(root, 'middleware-audit.db')
    : path.join(root, 'var', 'db', 'middleware-dev.db');

const db = require('../../../database');
const { createInvite } = require('../../../services/provider-invite-service');
const { convertLeadToCustomer } = require('../../../services/lead-convert-service');
const { transitionState } = require('../../../services/voice-onboarding-state');

function uniqueEmail() {
  return `onboard-e2e-${Date.now()}-${Math.floor(Math.random() * 10000)}@example.com`;
}

function createPendingInvite(opts = {}) {
  const email = opts.email || uniqueEmail();
  const invite = createInvite({
    email,
    practiceName: opts.practiceName || 'E2E Dental Practice',
    officeType: 'dental',
    useCase: 'dental',
    createdBy: 'e2e'
  });
  return { invite, email };
}

async function acceptInviteViaApi(request, code, { password = 'TestPass123!', name = 'E2E Provider' } = {}) {
  const res = await request.post(`/api/invites/${encodeURIComponent(code)}/accept`, {
    data: { name, password, baa_acknowledged: true }
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok() || !body.success) {
    throw new Error(body.error || `invite accept failed: ${res.status()}`);
  }
  return body;
}

async function createConvertedLead(opts = {}) {
  const leadId = `lead_e2e_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const email = opts.email || uniqueEmail();
  const password = opts.password || 'E2eTestPassword1!';
  db.db
    ?.prepare(
      `INSERT INTO leads (id, title, clinic_name, clinic_email, pipeline_stage, status)
       VALUES (?, ?, ?, ?, 'qualified', 'new')`
    )
    .run(leadId, 'E2E Convert Lead', opts.practiceName || 'E2E Convert Practice', email);

  const result = await convertLeadToCustomer(leadId, {
    send_email: false,
    ...opts
  });
  const bcrypt = require('bcryptjs');
  const passwordHash = await bcrypt.hash(password, 10);
  db.db?.prepare(`UPDATE customers SET password_hash = ? WHERE id = ?`).run(passwordHash, result.customerId);
  return { leadId, email, password, ...result };
}

function setOnboardingWizardStep(customerId, step) {
  transitionState(db, customerId, 'voice_setup_incomplete', { wizard_step: step, source: 'e2e' });
}

function markVoiceSetupComplete(customerId) {
  if (!customerId) throw new Error('markVoiceSetupComplete requires customerId');
  transitionState(db, customerId, 'voice_setup_complete', { source: 'e2e' });
}

async function createDoctorPortalProvider(opts = {}) {
  const result = await createConvertedLead(opts);
  markVoiceSetupComplete(result.customerId);
  return result;
}

async function loginProvider(page, request, { email, password }) {
  const res = await request.post('/api/customers/login', {
    data: { email, password, remember_me: true }
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok() || !body.success) {
    throw new Error(body.error || `login failed: ${res.status()}`);
  }
  const { cookies } = await request.storageState();
  if (cookies.length) {
    await page.context().addCookies(cookies);
  }
  if (body.customer && page) {
    await page.addInitScript((customer) => {
      sessionStorage.setItem('authenticated', 'true');
      sessionStorage.setItem('customer', JSON.stringify(customer));
    }, body.customer);
  }
  return body;
}

async function acceptInviteAndSeedPage(page, request, code, opts = {}) {
  await acceptInviteViaApi(request, code, opts);
  const { cookies } = await request.storageState();
  if (cookies.length) await page.context().addCookies(cookies);
  const meRes = await request.get('/api/customers/me');
  const me = await meRes.json().catch(() => ({}));
  if (me.customer) {
    await page.addInitScript((customer) => {
      sessionStorage.setItem('authenticated', 'true');
      sessionStorage.setItem('customer', JSON.stringify(customer));
    }, me.customer);
  }
}

async function stubVoiceSetupApis(page, opts = {}) {
  const previewText =
    opts.previewText ||
    'Thank you for calling E2E Dental. How can I help you today?';

  await page.route('**/api/voice-agent/onboarding**', async (route) => {
    const method = route.request().method();
    if (method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          onboarding_state: 'voice_setup_incomplete',
          destination: { path: '/business/voice-setup.html?step=1', wizard_step: 1 },
          onboarding_meta: {}
        })
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true })
    });
  });

  await page.route('**/api/voice-agent/settings**', async (route) => {
    const method = route.request().method();
    if (method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          settings: {
            greeting: 'Thank you for calling E2E Dental.',
            business_hours: { mon: '09:00-17:00', tue: '09:00-17:00' },
            tone_preset: 'warm',
            retell_agent_id: 'agent_e2e_stub'
          }
        })
      });
      return;
    }
    if (method === 'PATCH' || method === 'PUT' || method === 'POST') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, settings_version: 2 })
      });
      return;
    }
    await route.continue();
  });

  await page.route('**/api/voice-agent/preview**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        preview: {
          inbound: { text: previewText },
          outbound: { text: null, enabled: false },
          activeOpener: { text: previewText }
        },
        live_opener: { text: previewText },
        sync_status: 'synced'
      })
    });
  });

  await page.route('**/api/voice-agent/config-status**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        config_status: { ready: true, missing: [] }
      })
    });
  });

  await page.route('**/api/voice-agent/setup-complete**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, onboarding_state: 'voice_setup_complete' })
    });
  });

  await page.route('**/api/voice-billing/status**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        billing: { twilio_phone_number: '+15551234567' }
      })
    });
  });

  await page.route('**/api/voice-agent/test-call/latest**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: false })
    });
  });
}

async function stubCalendarApis(page, email, opts = {}) {
  await page.route('**/api/calendar/**', async (route) => {
    const url = route.request().url();
    const method = route.request().method();
    if (url.includes('/select') && method === 'POST') {
      const payload = route.request().postDataJSON();
      if (typeof opts.onSelect === 'function') opts.onSelect(payload);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, calendar_id: payload?.calendar_id })
      });
      return;
    }
    if (url.includes('/calendars')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          connected: true,
          calendars: [
            { id: 'primary', name: 'Primary calendar', primary: true },
            { id: 'scheduling', name: 'Scheduling', primary: false }
          ]
        })
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        connected: true,
        calendar_email: email,
        calendar_id: 'primary'
      })
    });
  });
}

async function waitVoiceSetupReady(page, timeout = 20_000) {
  await page.waitForFunction(() => window.__voiceSetupReady === true, { timeout });
}

async function waitWizardStep(page, stepNum, timeout = 30_000) {
  await page.waitForFunction(
    (n) => {
      const el = document.getElementById(`step${n}`);
      return el && !el.classList.contains('hidden');
    },
    stepNum,
    { timeout }
  );
}

/**
 * Walk voice-setup steps 1–6 using Somo calendar (no OAuth).
 */
async function completeVoiceSetupWizard(page, opts = {}) {
  const throughStep = opts.throughStep ?? 6;
  await stubVoiceSetupApis(page, { previewText: opts.previewText });
  await page.locator('#setupPracticeName').waitFor({ state: 'visible', timeout: 20_000 });
  await waitVoiceSetupReady(page);
  await page.locator('#setupPracticeName').fill('E2E Practice');
  await page.locator('#setupTransferNumber').fill('+12025550100');
  await page.locator('#setupClinicEmail').fill('frontdesk@e2e.example.com');
  await page.locator('#setupNext1').click();
  await page.waitForResponse(
    (resp) => resp.url().includes('/api/voice-agent/settings') && resp.request().method() === 'PATCH',
    { timeout: 20_000 }
  ).catch(() => {});
  await waitWizardStep(page, 2);

  if (throughStep <= 1) return;

  await page.locator('#setupUseSomoCal').click();
  await page.locator('#setupNext2').waitFor({ state: 'visible', timeout: 15_000 });
  await page.locator('#setupNext2').click();
  await waitWizardStep(page, 3);

  if (throughStep <= 2) return;

  const greeting = await page.locator('#setupGreeting').inputValue();
  if (!greeting.trim()) {
    await page.locator('#setupGreeting').fill('Thank you for calling E2E Dental. How can I help you today?');
  }
  if (opts.previewText) {
    await expect.poll(
      async () => page.locator('#setupPreview [data-live-opener-text]').textContent(),
      { timeout: 20_000 }
    ).toBe(opts.previewText);
  }
  if (throughStep <= 3) return;

  await page.locator('#setupNext3').click();
  await waitWizardStep(page, 4);
  if (throughStep <= 4) return;

  await page.locator('#setupNext4').click();
  await waitWizardStep(page, 5);
  if (throughStep <= 5) return;

  await page.locator('#setupNext5').click();
  await page.locator('#setupFinish').waitFor({ state: 'visible', timeout: 15_000 });
}

module.exports = {
  db,
  uniqueEmail,
  createPendingInvite,
  acceptInviteAndSeedPage,
  createConvertedLead,
  createDoctorPortalProvider,
  markVoiceSetupComplete,
  setOnboardingWizardStep,
  loginProvider,
  waitWizardStep,
  waitVoiceSetupReady,
  stubVoiceSetupApis,
  stubCalendarApis,
  completeVoiceSetupWizard
};
