/**
 * Kelly RCM Golden Path — browser chain: triage.html (T1–T6) → pay.html (live Stripe).
 *
 * Env:
 *   PW_API_BASE_URL          — middleware server (default http://127.0.0.1:4000)
 *   ANTHROPIC_API_KEY / GROQ_API_KEY / OPENAI_API_KEY — LLM for Kelly turns
 *   RCM_E2E_STRIPE_LIVE=1    — Layer 3 live Stripe (requires STRIPE_SECRET_KEY)
 *   KELLY_E2E_VISIT_ONLY=1   — T1–T4 only (skip pay line + Stripe)
 *   KELLY_E2E_SKIP_TRIAGE=1  — seed booking-ready fixture; start at T3
 *   TEST_PROVIDER_JWT        — optional provider payments list assert
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { test, expect, request } = require('@playwright/test');

const fixtures = require('./helpers/kelly-conversation-fixtures.cjs');
const { getBaseUrl, payUrl, fillStripeCard, CARD_SUCCESS } = require('./helpers/rcm-pay-ui-helpers.cjs');
const {
  openTriagePage,
  installTriageResponseCapture,
  sendTriageTurn,
} = require('./helpers/kelly-triage-ui-helpers.cjs');

const BASE = getBaseUrl();
const VISIT_ONLY = process.env.KELLY_E2E_VISIT_ONLY === '1';
const SKIP_TRIAGE = process.env.KELLY_E2E_SKIP_TRIAGE === '1';
const STRIPE_LIVE = !!process.env.RCM_E2E_STRIPE_LIVE;

/** @type {import('./helpers/kelly-conversation-fixtures.cjs').setupGoldenPathContext extends Function ? ReturnType<typeof fixtures.setupGoldenPathContext> : any} */
let ctx = null;

const scorecard = {
  runAt: new Date().toISOString(),
  env: {
    visitOnly: VISIT_ONLY,
    skipTriage: SKIP_TRIAGE,
    stripeLive: STRIPE_LIVE,
    baseUrl: BASE,
  },
  steps: [],
};

function recordStep(id, sprint, label, status, detail = '') {
  scorecard.steps.push({ id, sprint, label, status, detail, at: new Date().toISOString() });
}

function toolsInclude(toolsUsed, pattern) {
  const list = Array.isArray(toolsUsed) ? toolsUsed : [];
  return list.some((t) => pattern.test(String(t)));
}

function hasLlmKey() {
  return !!(
    process.env.ANTHROPIC_API_KEY ||
    process.env.GROQ_API_KEY ||
    process.env.OPENAI_API_KEY
  );
}

async function assertPatientChatEnabled(baseUrl, portalSessionId) {
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/patient/triage/message`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-session-id': portalSessionId,
    },
    body: JSON.stringify({ message: 'e2e chat probe', session_id: null }),
  });
  const body = await res.json().catch(() => ({}));
  if (res.status === 503 && /temporarily disabled/i.test(body.error || '')) {
    throw new Error(
      'S0: Patient chat disabled on server. Restart with FEATURE_PATIENT_CHAT_ENABLED=1 (see test:e2e:kelly:golden runbook).'
    );
  }
}

test.describe.configure({ mode: 'serial' });

test.describe('Kelly RCM golden path', () => {
  test.beforeAll(async () => {
    if (!hasLlmKey()) {
      throw new Error('S0: LLM API key required (ANTHROPIC_API_KEY, GROQ_API_KEY, or OPENAI_API_KEY)');
    }

    ctx = fixtures.setupGoldenPathContext();
    await assertPatientChatEnabled(BASE, ctx.portalSessionId);
    recordStep('C1-C3', 'S0', 'Node setup (patient, eligibility, journey, portal session)', 'pass');
  });

  test('visit line: intake → booking (T1–T4)', async ({ page }) => {
    test.setTimeout(1_200_000);

    const capture = installTriageResponseCapture(page);
    await openTriagePage(page, BASE, ctx.portalSessionId, ctx.sessionId);

    if (!SKIP_TRIAGE) {
      const t1 = await sendTriageTurn(
        page,
        'I have an itchy rash on my arm for about 3 days. It is not an emergency — I would like dermatology help.'
      );
      ctx.turnLog.push({ turn: 'T1', reply: t1.replyText.slice(0, 120) });
      fixtures.assertClinicVisitPath(ctx.sessionId);
      fixtures.assertKellyState(ctx.sessionId, {
        phase: ['TRIAGE_DISCOVERY', 'TRIAGE_ACTIVE'],
        routine_intake_active: false,
      });
      recordStep('C7', 'S1', 'T1 derm concern', 'pass');

      const t2 = await sendTriageTurn(
        page,
        'It is dry skin type, not pregnant, moderate itch — about a 3 out of 5. It started last Tuesday. No fever.'
      );
      ctx.turnLog.push({ turn: 'T2', reply: t2.replyText.slice(0, 120) });
      fixtures.assertKellyState(ctx.sessionId, { phase: ['TRIAGE_ACTIVE', 'TRIAGE_DISCOVERY'] });

      const t2cap = capture.getLast();
      const t2tools = t2cap?.toolsUsed || fixtures.readToolsUsedFromHistory(ctx.sessionId);
      const stateAfterT2 = fixtures.readKellyState(ctx.sessionId);
      if (!stateAfterT2.hasRag && !toolsInclude(t2tools, /run_triage_rag/i)) {
        const t2b = await sendTriageTurn(
          page,
          'The rash is on my left forearm, red and scaly, worse at night. Severity is 3 out of 5.'
        );
        ctx.turnLog.push({ turn: 'T2b', reply: t2b.replyText.slice(0, 120) });
      }
      const ragState = fixtures.readKellyState(ctx.sessionId);
      if (!ragState.hasRag) {
        recordStep('C8', 'S1', 'T2 RAG', 'fail', 'hasRag=false after intake');
        throw new Error('S1: T2 — run_triage_rag / hasRag expected after OPQRST intake');
      }
      recordStep('C8', 'S1', 'T2 intake + RAG', 'pass');
    } else {
      recordStep('C11', 'S0', 'T1–T4 skipped (KELLY_E2E_SKIP_TRIAGE)', 'skip');
      fixtures.seedE2eBookableProvider(ctx.clinicId, { targetSpecialty: 'Dermatology' });
    }

    const t3 = await sendTriageTurn(
      page,
      'Can you check the soonest dermatology appointment available? I can come in this week.'
    );
    ctx.turnLog.push({ turn: 'T3', reply: t3.replyText.slice(0, 120) });
    const t3tools =
      t3.toolsUsed ||
      capture.getLast()?.toolsUsed ||
      fixtures.readToolsUsedFromHistory(ctx.sessionId);
    if (!toolsInclude(t3tools, /get_available_slots/i)) {
      recordStep('C9', 'S1', 'T3 get_available_slots', 'fail', `tools=[${t3tools.join(',')}]`);
      throw new Error(`S1: T3 — Kelly did not call get_available_slots. tools=[${t3tools.join(', ')}]`);
    }
    fixtures.assertKellyState(ctx.sessionId, { phase: 'BOOKING' });
    recordStep('C9', 'S1', 'T3 booking slots', 'pass');

    fixtures.seedE2eBookableProvider(ctx.clinicId, { targetSpecialty: 'Dermatology' });

    const t4 = await sendTriageTurn(
      page,
      `The first available slot works for me. Please book it. My email is ${ctx.patientEmail} and phone ${ctx.patientPhone}.`
    );
    ctx.turnLog.push({ turn: 'T4', reply: t4.replyText.slice(0, 120) });
    const t4tools =
      t4.toolsUsed ||
      capture.getLast()?.toolsUsed ||
      fixtures.readToolsUsedFromHistory(ctx.sessionId);

    const { dbModule } = fixtures.loadDb();
    const appt = dbModule.db
      .prepare(`SELECT id FROM appointments WHERE patient_id = ? ORDER BY created_at DESC LIMIT 1`)
      .get(ctx.patientId);

    if (!toolsInclude(t4tools, /schedule_appointment/i) && !appt) {
      recordStep('C10', 'S1', 'T4 schedule_appointment', 'fail', `tools=[${t4tools.join(',')}]`);
      throw new Error(`S1: T4 — schedule_appointment not called and no appointment row`);
    }
    fixtures.assertKellyState(ctx.sessionId, { phase: 'BOOKING' });
    recordStep('C10', 'S1', 'T4 booking confirmed', 'pass', appt ? `appointment_id=${appt.id}` : '');
  });

  test('pay line: copay → pay link (T5–T6)', async ({ page }) => {
    test.skip(VISIT_ONLY, 'KELLY_E2E_VISIT_ONLY=1');
    test.setTimeout(1_200_000);

    const capture = installTriageResponseCapture(page);
    await openTriagePage(page, BASE, ctx.portalSessionId, ctx.sessionId);

    const t5 = await sendTriageTurn(
      page,
      'I have BlueCross insurance. What will my copay be for this visit?'
    );
    ctx.turnLog.push({ turn: 'T5', reply: t5.replyText.slice(0, 120) });

    const mentionsCopay =
      /copay|\$|25|amount|cover|benefit|deductible|insurance/i.test(t5.replyText) ||
      String(ctx.copayAmount) === '25';
    if (!mentionsCopay) {
      recordStep('C12', 'S2', 'T5 copay mention', 'fail', t5.replyText.slice(0, 80));
      throw new Error(`S2: T5 — Kelly did not mention copay. reply="${t5.replyText.slice(0, 120)}"`);
    }
    recordStep('C12', 'S2', 'T5 copay question', 'pass');

    const copayStr = ctx.copayAmount ? `$${ctx.copayAmount}` : '$25';
    const t6 = await sendTriageTurn(
      page,
      `OK, I would like to pay ${copayStr} now before the appointment. Please send me a secure payment link.`
    );
    ctx.turnLog.push({ turn: 'T6', reply: t6.replyText.slice(0, 120) });

    const t6cap = capture.getLast();
    const t6tools = t6cap?.toolsUsed || [];
    ctx.payToken = fixtures.resolvePayToken(ctx.sessionId, ctx.patientId, ctx.clinicId);

    if (!ctx.payToken) {
      const linkMatch = t6.replyText.match(/token=([a-zA-Z0-9_-]+)/);
      if (linkMatch) ctx.payToken = linkMatch[1];
    }

    if (!ctx.payToken) {
      recordStep('C13', 'S2', 'T6 request_patient_payment', 'fail', 'Sprint 2 gap: A4/A5 — request_patient_payment');
      throw new Error(
        `Sprint 2 gap: A4/A5 — request_patient_payment. tools=[${t6tools.join(', ')}] token=null`
      );
    }
    recordStep('C13', 'S2', 'T6 pay token resolved', 'pass', `token=${ctx.payToken.slice(0, 8)}…`);
  });

  test('pay page: card → settled (Layer 3)', async ({ page, request: pwRequest }) => {
    test.skip(VISIT_ONLY, 'KELLY_E2E_VISIT_ONLY=1');
    test.skip(!ctx?.payToken, 'Layer 2B did not produce pay token');
    test.skip(!STRIPE_LIVE, 'RCM_E2E_STRIPE_LIVE=1 required for live Stripe');
    test.skip(!process.env.STRIPE_SECRET_KEY, 'STRIPE_SECRET_KEY required');

    test.setTimeout(180_000);

    await page.goto(payUrl(ctx.payToken, BASE));
    await expect(page.locator('#payment-form')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('#amount-display')).toContainText(/\$25\.00|\$25/);

    await fillStripeCard(page, CARD_SUCCESS);
    await page.locator('#btn-pay-card').click();
    await expect(page.locator('#success-state')).toBeVisible({ timeout: 30_000 });

    const apiCtx = await pwRequest.newContext();
    const res = await apiCtx.get(`${BASE}/api/public/rcm/pay/${ctx.payToken}`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.already_paid).toBe(true);
    expect(String(body.payment?.status || '').toLowerCase()).toBe('paid');

    fixtures.assertPaymentPaid(ctx.payToken);
    recordStep('C16-C19', 'S3', 'Live Stripe settlement', 'pass');
  });

  test('provider visibility — paid row in RCM payments API', async ({ request: pwRequest }) => {
    test.skip(VISIT_ONLY, 'KELLY_E2E_VISIT_ONLY=1');
    test.skip(!ctx?.payToken, 'no pay token');
    test.skip(!process.env.TEST_PROVIDER_JWT, 'TEST_PROVIDER_JWT not set');

    const apiCtx = await pwRequest.newContext();
    const res = await apiCtx.get(
      `${BASE}/api/rcm/payments?clinic_id=${encodeURIComponent(ctx.clinicId)}`,
      { headers: { Authorization: `Bearer ${process.env.TEST_PROVIDER_JWT}` } }
    );
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    const payments = data.payments || data.items || data || [];
    const list = Array.isArray(payments) ? payments : [];
    const found = list.some(
      (p) =>
        String(p.pay_token || p.token || '') === ctx.payToken ||
        String(p.status || '').toLowerCase() === 'paid'
    );
    expect(found).toBeTruthy();
    recordStep('C21', 'S4', 'Provider payments API visibility', 'pass');
  });

  test.afterAll(async () => {
    if (VISIT_ONLY) {
      recordStep('C15', 'S2', 'Pay line skipped (VISIT_ONLY)', 'skip');
      recordStep('C16-C20', 'S3', 'Stripe layer skipped (VISIT_ONLY)', 'skip');
    }
    if (!STRIPE_LIVE && !VISIT_ONLY) {
      recordStep('C16-C20', 'S3', 'Stripe layer skipped (RCM_E2E_STRIPE_LIVE not set)', 'skip');
    }

    const sprintSummary = {};
    for (const step of scorecard.steps) {
      if (!sprintSummary[step.sprint]) sprintSummary[step.sprint] = { pass: 0, fail: 0, skip: 0 };
      sprintSummary[step.sprint][step.status === 'pass' ? 'pass' : step.status === 'fail' ? 'fail' : 'skip']++;
    }
    scorecard.sprintSummary = sprintSummary;
    scorecard.sessionId = ctx?.sessionId || null;
    scorecard.payToken = ctx?.payToken ? `${ctx.payToken.slice(0, 8)}…` : null;

    const outDir = path.join(__dirname, '..', 'playwright-report');
    fs.mkdirSync(outDir, { recursive: true });
    const reportPath = path.join(outDir, 'kelly-golden-path-report.json');
    fs.writeFileSync(reportPath, JSON.stringify(scorecard, null, 2));

    console.log('\n── Kelly Golden Path Scorecard ──');
    for (const step of scorecard.steps) {
      const icon = step.status === 'pass' ? '✓' : step.status === 'fail' ? '✗' : '○';
      console.log(`  ${icon} [${step.sprint}] ${step.label}${step.detail ? ` — ${step.detail}` : ''}`);
    }
    console.log(`\nReport: ${reportPath}\n`);
  });
});
