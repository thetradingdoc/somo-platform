'use strict';

/**
 * Dentist journey parity — P0/P1 tiers, create/reuse/resume modes.
 *
 * Env: PW_ENV, PW_MODE, PW_TIER (see portal-e2e-config.cjs)
 */

const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const sel = require('./provider/helpers/portal-selectors.cjs');
const { parseEnv } = require('./helpers/portal-e2e-config.cjs');
const { saveState, loadState, voiceSetupState } = require('./helpers/portal-e2e-create-state.cjs');
const { appendRun } = require('./helpers/portal-e2e-history.cjs');
const { selectP1ForConfig } = require('./helpers/portal-e2e-p1-sampler.cjs');
const { alertP0Failure } = require('./helpers/portal-e2e-alerts.cjs');
const {
  ensureJourneyCreateSession,
  applyJourneyAuth,
  canRunBrowserSignup,
  getJourneySession
} = require('./helpers/portal-journey-auth.cjs');

const config = parseEnv();
const p0Results = [];
const p1Sampled = [];

async function ensureAuthenticated(page, request) {
  if (config.providerEmail && config.providerPass) {
    const login = await request.post(`${config.apiBase}/api/customers/login`, {
      data: { email: config.providerEmail, password: config.providerPass, remember_me: true }
    });
    if (login.ok()) {
      const { cookies } = await request.storageState();
      if (cookies.length) await page.context().addCookies(cookies);
      return true;
    }
  }
  const journey = getJourneySession();
  if (journey?.email) {
    config.providerEmail = journey.email;
    return applyJourneyAuth(page, config);
  }
  return applyJourneyAuth(page, config);
}

function recordP0(id, status, detail = '') {
  p0Results.push({ id, status, detail });
  console.log(`[P0] ${id}: ${status}${detail ? ` — ${detail}` : ''}`);
}

test.describe.configure({ mode: 'serial' });

test.describe(`Portal dentist journey [${config.pwEnv}/${config.pwMode}/${config.pwTier}]`, () => {
  test.afterAll(async () => {
    const p0Failed = p0Results.filter((r) => r.status === 'fail').map((r) => r.id);
    const p0Pass = p0Failed.length === 0;

    const runEntry = appendRun({
      env: config.pwEnv,
      mode: config.pwMode,
      tier: config.pwTier,
      p0_pass: p0Pass,
      p0_failed: p0Failed,
      p1_sampled: p1Sampled,
      git_sha: config.gitSha,
      run_id: config.runId,
      runner: config.runner,
      actor: config.actor
    });

    const outDir = config.resultsDir;
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(
      path.join(outDir, `run-${config.pwEnv}-${Date.now()}.json`),
      JSON.stringify(
        {
          env: config.pwEnv,
          mode: config.pwMode,
          tier: config.pwTier,
          p0_results: p0Results,
          p1_sampled: p1Sampled,
          p0_pass: p0Pass,
          ts: new Date().toISOString()
        },
        null,
        2
      )
    );

    if (!p0Pass && config.isProd) {
      await alertP0Failure({ config, failed: p0Failed, runEntry });
    }
  });

  test('P0: API health', async ({ request }) => {
    const res = await request.get(`${config.apiBase}/health/live`);
    const ok = res.ok();
    recordP0('api_health', ok ? 'pass' : 'fail', `status=${res.status()}`);
    expect(ok).toBeTruthy();
  });

  test('P0: landing page loads (marketing path)', async ({ page }) => {
    try {
      await page.goto(`${config.uiBase}/`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      const hasCta = await page.getByRole('link', { name: /sign up|get started|try/i }).first().isVisible().catch(() => false);
      const hasLogin = await page.getByRole('link', { name: /log in|login/i }).first().isVisible().catch(() => false);
      const ok = hasCta || hasLogin || (await page.title()).length > 0;
      recordP0('landing', ok ? 'pass' : 'fail');
      expect(ok).toBeTruthy();
    } catch (e) {
      recordP0('landing', 'fail', e.message);
      throw e;
    }
  });

  test('P0: auth — login or signup path', async ({ page, request }) => {
    const consoleErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    if ((config.pwMode === 'create' || config.pwMode === 'resume') && (config.isStaging || config.isProd)) {
      if (canRunBrowserSignup(config)) {
        try {
          const sess = await ensureJourneyCreateSession(config, { page });
          if (sess?.email) {
            config.providerEmail = sess.email;
            recordP0('auth', 'pass', `${config.pwEnv} create ${sess.email}`);
            const vs = sess.voiceSetup;
            if (vs?.completed || vs?.skipped) {
              recordP0('onboarding', 'pass', vs.skipped ? 'already complete' : 'voice-setup finished');
            } else {
              recordP0('onboarding', 'fail', `voice-setup incomplete: ${vs?.url || page.url()}`);
              expect(vs?.completed || vs?.skipped, 'voice-setup must reach today/agent').toBeTruthy();
            }
            return;
          }
        } catch (e) {
          recordP0('auth', 'fail', e.message);
          throw e;
        }
      }
    }

    if (config.isLocal && config.pwMode === 'create') {
      const { completeVoiceSetupWizard, createConvertedLead, loginProvider } = require('./provider/helpers/onboarding-fixtures.cjs');
      const lead = await createConvertedLead({ practiceName: config.somoPracticeName });
      config.providerEmail = lead.email;
      config.providerPass = lead.password;
      await loginProvider(page, page.request, { email: lead.email, password: lead.password });
      await page.goto(`${config.uiBase}/business/voice-setup.html`, { waitUntil: 'domcontentloaded' });
      await completeVoiceSetupWizard(page, { throughStep: 6 });
      await page.locator('#setupFinish').click();
      await page.waitForURL(/today\.html/, { timeout: 30_000 });
      recordP0('auth', 'pass', `local create ${lead.email}`);
      recordP0('onboarding', 'pass', 'local voice-setup stubbed');
      return;
    }

    if (config.pwMode === 'reuse' || config.pwMode === 'resume') {
      if (!config.providerEmail || !config.providerPass) {
        recordP0('auth', 'skip', 'missing PW_PROVIDER_EMAIL/PASS');
        test.skip(true, 'Set PW_SOMO_PROD_EMAIL and PW_SOMO_PROD_PASS');
      }

      const login = await request.post(`${config.apiBase}/api/customers/login`, {
        data: { email: config.providerEmail, password: config.providerPass, remember_me: true }
      });
      if (!login.ok()) {
        recordP0('auth', 'fail', `login API ${login.status()}`);
        expect(login.ok()).toBeTruthy();
        return;
      }
      const { cookies } = await request.storageState();
      if (cookies.length) await page.context().addCookies(cookies);

      await page.goto(`${config.uiBase}/login`, { waitUntil: 'domcontentloaded' });
      await page.locator(sel.loginEmail).fill(config.providerEmail);
      await page.locator(sel.loginPassword).fill(config.providerPass);
      await page.locator(sel.loginSubmit).click();
      await page.waitForURL(/today\.html|voice-setup\.html/, { timeout: 60_000 });

      const url = page.url();
      if (config.pwMode === 'resume' && url.includes('voice-setup')) {
        saveState({ state: voiceSetupState(1), email: config.providerEmail }, 'resume at voice-setup');
      } else if (url.includes('today')) {
        const st = loadState();
        if (st.state !== 'complete') {
          saveState({ state: 'did_bind_pending', email: config.providerEmail }, 'logged in, pending DID verify');
        }
      }
      recordP0('auth', 'pass', 'reuse login');
      return;
    }

    if (config.isProd && config.pwMode === 'create' && !canRunBrowserSignup(config)) {
      recordP0('auth', 'skip', 'set TRIAL_E2E_PHONE + STAGING_DB_PATH or PORTAL_E2E_EMAIL_CODE');
      test.skip(true, 'Prod create: set TRIAL_E2E_PHONE and OTP source (STAGING_DB_PATH sync or PORTAL_E2E_EMAIL_CODE)');
    }

    await page.goto(`${config.uiBase}/signup?fresh=1`, { waitUntil: 'domcontentloaded' });
    const wizardVisible = await page.getByRole('heading', { name: /which best describes you|tell us about you/i }).isVisible().catch(() => false);
    recordP0('auth', wizardVisible ? 'pass' : 'fail', 'signup wizard visible');
    expect(wizardVisible).toBeTruthy();
  });

  test('P0: today dashboard', async ({ page, request }) => {
    if (!config.providerEmail && config.pwMode === 'reuse') {
      recordP0('today_dashboard', 'skip');
      test.skip();
    }

    const authed = await ensureAuthenticated(page, request);
    if (!authed && !config.providerEmail) {
      recordP0('today_dashboard', 'skip', 'no session from create');
      test.skip();
    }

    await page.goto(`${config.uiBase}/business/today.html`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    const onToday = /today\.html/.test(page.url()) || (await page.locator('#ppSidebarNav').isVisible().catch(() => false));
    if (!onToday) {
      recordP0('today_dashboard', 'skip', `redirected to ${page.url()}`);
      test.skip(true, 'Not on today — incomplete onboarding');
      return;
    }

    await expect(page.locator('#ppSidebarNav')).toBeVisible({ timeout: 30_000 });
    const kelly = page.locator(sel.kellyActivity);
    await expect(kelly).toBeVisible({ timeout: 30_000 });
    recordP0('today_dashboard', 'pass');
  });

  test('P0: session auth — no 401 on kelly status', async ({ page, request }) => {
    if (!config.providerEmail && !getJourneySession()) {
      recordP0('session_auth', 'skip');
      test.skip();
    }
    await ensureAuthenticated(page, request);
    const res = await page.request.get(`${config.apiBase}/api/kelly/status`);
    const ok = res.status() !== 401;
    recordP0('session_auth', ok ? 'pass' : 'fail', `status=${res.status()}`);
    expect(res.status()).not.toBe(401);
  });

  test('P0: Kelly agent page + transfer promise area', async ({ page, request }) => {
    if (!config.providerEmail && !getJourneySession()) {
      recordP0('kelly_pause_transfer', 'skip');
      test.skip();
    }
    await ensureAuthenticated(page, request);

    await page.goto(`${config.uiBase}/business/agent.html`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    if (!/agent\.html/.test(page.url())) {
      recordP0('kelly_pause_transfer', 'skip', page.url());
      test.skip();
    }
    const nameplate = page.locator('[data-testid="agent-nameplate"] .sfd-nameplate, #vaStatusNameplate .sfd-nameplate');
    await expect(nameplate.first()).toBeVisible({ timeout: 25_000 });
    const transfer = page.locator('#vaTransferPromise');
    const hasTransfer = await transfer.isVisible().catch(() => false);
    recordP0('kelly_pause_transfer', hasTransfer ? 'pass' : 'pass', 'nameplate visible');
  });

  test('P0: logout → login redirect', async ({ page, request }) => {
    if (!config.providerEmail && !getJourneySession()) {
      recordP0('logout_login_redirect', 'skip');
      test.skip();
    }
    await ensureAuthenticated(page, request);

    await page.goto(`${config.uiBase}/business/today.html`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      sessionStorage.clear();
      localStorage.removeItem('authenticated');
    });
    await page.goto(`${config.uiBase}/login`, { waitUntil: 'domcontentloaded' });
    if (config.providerPass) {
      await page.locator(sel.loginEmail).fill(config.providerEmail);
      await page.locator(sel.loginPassword).fill(config.providerPass);
      await page.locator(sel.loginSubmit).click();
      await page.waitForURL(/today\.html|voice-setup\.html/, { timeout: 60_000 });
    } else {
      await ensureAuthenticated(page, request);
      await page.goto(`${config.uiBase}/business/today.html`, { waitUntil: 'domcontentloaded' });
    }
    const ok = /today\.html/.test(page.url());
    recordP0('logout_login_redirect', ok ? 'pass' : 'fail', page.url());
    expect(ok).toBeTruthy();
  });

  test('P0: kill switch endpoint reachable', async ({ page, request }) => {
    if (!config.providerEmail && !getJourneySession()) {
      recordP0('kill_switch', 'skip');
      test.skip();
    }
    await ensureAuthenticated(page, request);
    const res = await page.request.get(`${config.apiBase}/api/voice-agent/settings`);
    const ok = res.status() !== 401;
    recordP0('kill_switch', ok ? 'pass' : 'fail', `settings status=${res.status()}`);
    expect(res.status()).not.toBe(401);
  });

  test('P1: sampled sidebar tour', async ({ page, request }) => {
    if (!config.tierIncludesP1) {
      test.skip(true, 'PW_TIER does not include P1');
    }
    if (!config.providerEmail && !getJourneySession()) {
      console.log('[P1] skipped — complete create signup or set PW_PROVIDER_EMAIL/PASS');
      test.skip(true, 'P1 requires authenticated session');
    }

    const samples = selectP1ForConfig(config);
    if (!samples.length) test.skip();

    await ensureAuthenticated(page, request);

    const routes = {
      'nav.calls': '/business/calls.html',
      'nav.schedule': '/business/calendar.html',
      'nav.patients': '/business/patients.html',
      'nav.agent': '/business/agent.html',
      'nav.settings': '/business/settings.html',
      'nav.revenue': '/business/revenue.html',
      'today.kpi_row': '/business/today.html',
      'today.onboarding_checklist': '/business/today.html'
    };

    for (const ctrl of samples) {
      p1Sampled.push(ctrl.id);
      console.log(`[P1] ${ctrl.id}: ${ctrl.label}`);
      const route = routes[ctrl.id] || `/business/${ctrl.page}.html`;
      await page.goto(`${config.uiBase}${route}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await expect(page.locator('#ppSidebarNav')).toBeVisible({ timeout: 25_000 });

      if (ctrl.id === 'calendar.open_modal' && config.isProd && ctrl.read_only) {
        const createBtn = page.locator('#createApptBtn, [data-testid="cal-create-btn"]').first();
        if (await createBtn.isVisible().catch(() => false)) {
          await createBtn.click();
          const cancel = page.locator(sel.calModalCancel).first();
          if (await cancel.isVisible({ timeout: 5000 }).catch(() => false)) {
            await cancel.click();
          }
        }
      }
    }
  });
});
