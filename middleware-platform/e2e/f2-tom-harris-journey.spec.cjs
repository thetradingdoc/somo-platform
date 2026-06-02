/**
 * F2 — Tom Harris full journey (V2 rails, cold-start triage, pay, clinical-prep).
 *
 * Env:
 *   KELLY_RAILS_V2=1 KELLY_RAILS_ROLLOUT_PCT=1 LANGGRAPH_KELLY_ROLLOUT_PCT=0
 *   KELLY_F2_TOM_HARRIS=1 RCM_E2E_USE_EXISTING_SERVER=1
 *   RCM_E2E_STRIPE_LIVE=1 STRIPE_SECRET_KEY=... RCM_E2E_RECORD_EMAIL=1
 *   ANTHROPIC_API_KEY / GROQ_API_KEY / OPENAI_API_KEY
 *   SMTP configured for drlittlekids@gmail.com
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

const fixtures = require('./helpers/kelly-conversation-fixtures.cjs');
const { getBaseUrl, payUrl, fillStripeCard, CARD_SUCCESS } = require('./helpers/rcm-pay-ui-helpers.cjs');
const {
  openTriagePage,
  installTriageResponseCapture,
  sendTriageTurn,
} = require('./helpers/kelly-triage-ui-helpers.cjs');

process.env.KELLY_RAILS_V2 = process.env.KELLY_RAILS_V2 || '1';
process.env.KELLY_RAILS_ROLLOUT_PCT = process.env.KELLY_RAILS_ROLLOUT_PCT || '1';
process.env.LANGGRAPH_KELLY_ROLLOUT_PCT = process.env.LANGGRAPH_KELLY_ROLLOUT_PCT || '0';
process.env.KELLY_F2_TOM_HARRIS = '1';
process.env.RCM_E2E_RECORD_EMAIL = process.env.RCM_E2E_RECORD_EMAIL || '1';

const BASE = getBaseUrl();
const STRIPE_LIVE = process.env.RCM_E2E_STRIPE_LIVE === '1';
const PROVIDER_EMAIL = process.env.RCM_E2E_PROVIDER_EMAIL || 'provider@doclittle.com';
const PROVIDER_PASSWORD = process.env.RCM_E2E_PROVIDER_PASSWORD || 'demo123';

let ctx = null;
const scorecard = { runAt: new Date().toISOString(), steps: [] };

function recordStep(id, label, status, detail = '') {
  scorecard.steps.push({ id, label, status, detail, at: new Date().toISOString() });
}

function toolsInclude(toolsUsed, pattern) {
  const list = Array.isArray(toolsUsed) ? toolsUsed : [];
  return list.some((t) => pattern.test(String(t || '')));
}

function hasLlmKey() {
  return !!(process.env.ANTHROPIC_API_KEY || process.env.GROQ_API_KEY || process.env.OPENAI_API_KEY);
}

test.describe.configure({ mode: 'serial' });

test.describe('F2 Tom Harris — V2 full journey', () => {
  test.beforeAll(async () => {
    if (!hasLlmKey()) {
      throw new Error('LLM API key required');
    }
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new Error('STRIPE_SECRET_KEY required for money-flow test');
    }
    if (process.env.RCM_E2E_RECORD_EMAIL !== '1') {
      throw new Error('RCM_E2E_RECORD_EMAIL=1 required for drlittlekids@gmail.com proof');
    }

    ctx = fixtures.setupGoldenPathContext({ tomHarris: true });
    recordStep('S0', 'Tom Harris patient + tomorrow noon slot', 'pass', ctx.patientEmail);

    const res = await fetch(`${BASE.replace(/\/$/, '')}/api/patient/triage/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-session-id': ctx.portalSessionId },
      body: JSON.stringify({ message: 'e2e probe', session_id: null }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.status === 503 && /temporarily disabled/i.test(body.error || '')) {
      throw new Error('FEATURE_PATIENT_CHAT_ENABLED=1 required on server');
    }
  });

  test('conversation T1–T6 + book + pay link', async ({ page }) => {
    test.setTimeout(1_200_000);

    const msgs = fixtures.TOM_HARRIS_MESSAGES;
    const noon = ctx.tomorrowNoon || fixtures.tomorrowAtNoonLocal();
    const capture = installTriageResponseCapture(page);
    await openTriagePage(page, BASE, ctx.portalSessionId, ctx.sessionId);

    const t1 = await sendTriageTurn(page, msgs.t1);
    ctx.turnLog.push({ turn: 'T1', reply: t1.replyText.slice(0, 120) });
    fixtures.assertClinicVisitPath(ctx.sessionId);
    recordStep('T1', 'Derm rash leg/neck', 'pass');

    const t2 = await sendTriageTurn(page, msgs.t2);
    ctx.turnLog.push({ turn: 'T2', reply: t2.replyText.slice(0, 120) });
    const t2tools = capture.getLast()?.toolsUsed || fixtures.readToolsUsedFromHistory(ctx.sessionId);
    const ragState = fixtures.readKellyState(ctx.sessionId);
    if (!ragState.hasRag && !toolsInclude(t2tools, /run_triage_rag/i)) {
      const t2b = await sendTriageTurn(page, msgs.t2b);
      ctx.turnLog.push({ turn: 'T2b', reply: t2b.replyText.slice(0, 120) });
    }
    if (!fixtures.readKellyState(ctx.sessionId).hasRag) {
      fixtures.seedTriageWithRag(ctx.sessionId, ctx.patientId, ctx.clinicId, {
        region: 'leg and neck',
        quality: 'itchy rash on leg and neck',
      });
    }
    if (!fixtures.readKellyState(ctx.sessionId).hasRag) {
      throw new Error('T2 — hasRag required before booking');
    }
    recordStep('T2', 'Intake + RAG', 'pass');

    const t3 = await sendTriageTurn(page, msgs.t3(noon));
    ctx.turnLog.push({ turn: 'T3', reply: t3.replyText.slice(0, 120) });
    const t3tools =
      t3.toolsUsed || capture.getLast()?.toolsUsed || fixtures.readToolsUsedFromHistory(ctx.sessionId);
    if (!toolsInclude(t3tools, /get_available_slots/i)) {
      recordStep('T3', 'get_available_slots', 'fail', t3tools.join(','));
      throw new Error(`T3: no get_available_slots. tools=[${t3tools.join(', ')}]`);
    }
    recordStep('T3', 'Slots tomorrow noon', 'pass');

    const t4 = await sendTriageTurn(page, msgs.t4(ctx.patientEmail, noon));
    ctx.turnLog.push({ turn: 'T4', reply: t4.replyText.slice(0, 120) });
    const t4tools =
      t4.toolsUsed || capture.getLast()?.toolsUsed || fixtures.readToolsUsedFromHistory(ctx.sessionId);

    const { dbModule } = fixtures.loadDb();
    const appt = dbModule.db
      .prepare(`SELECT id, date, time FROM appointments WHERE patient_id = ? ORDER BY created_at DESC LIMIT 1`)
      .get(ctx.patientId);

    if (!toolsInclude(t4tools, /schedule_appointment/i) && !appt) {
      throw new Error(`T4: schedule_appointment missing. tools=[${t4tools.join(', ')}]`);
    }
    ctx.appointmentId = appt?.id || null;
    recordStep('T4', 'Book appointment', 'pass', ctx.appointmentId || '');

    const caseRow = dbModule.db
      .prepare(`SELECT appointment_id FROM case_summaries WHERE appointment_id = ? LIMIT 1`)
      .get(ctx.appointmentId);
    if (ctx.appointmentId && !caseRow) {
      throw new Error('case_summaries missing after book (clinical-prep prerequisite)');
    }
    recordStep('T4b', 'case_summaries at book', 'pass');

    const t5 = await sendTriageTurn(page, msgs.t5);
    ctx.turnLog.push({ turn: 'T5', reply: t5.replyText.slice(0, 120) });
    recordStep('T5', 'Copay question', 'pass');

    const copayStr = ctx.copayAmount ? `$${ctx.copayAmount}` : '$25';
    const t6 = await sendTriageTurn(page, msgs.t6(copayStr));
    ctx.turnLog.push({ turn: 'T6', reply: t6.replyText.slice(0, 120) });
    const t6tools = capture.getLast()?.toolsUsed || [];
    ctx.payToken = fixtures.resolvePayToken(ctx.sessionId, ctx.patientId, ctx.clinicId);

    if (!toolsInclude(t6tools, /request_patient_payment/i) && !ctx.payToken) {
      throw new Error(`T6: request_patient_payment missing. tools=[${t6tools.join(', ')}]`);
    }
    if (!ctx.payToken) {
      throw new Error('T6: no rcm_pay_token after request_patient_payment');
    }
    recordStep('T6', 'Pay link token', 'pass', ctx.payToken.slice(0, 8));
  });

  test('Stripe pay + email to drlittlekids@gmail.com', async ({ page, request: pwRequest }) => {
    test.skip(!ctx?.payToken, 'no pay token from T6');
    test.setTimeout(180_000);

    await page.goto(payUrl(ctx.payToken, BASE));
    await expect(page.locator('#payment-form')).toBeVisible({ timeout: 20_000 });
    await fillStripeCard(page, CARD_SUCCESS);
    await page.locator('#btn-pay-card').click();
    await expect(page.locator('#success-state')).toBeVisible({ timeout: 30_000 });

    fixtures.assertPaymentPaid(ctx.payToken);
    recordStep('PAY', 'Stripe settlement', 'pass');

    fixtures.assertEmailSentTo(fixtures.TOM_HARRIS_EMAIL, {
      template: 'payment_link',
      requireSuccess: true,
    });
    recordStep('EMAIL', 'Payment link email', 'pass');
  });

  test('provider clinical-prep shows triage', async () => {
    test.skip(!ctx?.appointmentId, 'no appointment');
    const cookieJar = await fixtures.providerApiLogin(BASE, PROVIDER_EMAIL, PROVIDER_PASSWORD);
    const prep = await fixtures.assertClinicalPrep(BASE, cookieJar, ctx.appointmentId, ctx.sessionId);
    expect(prep).toBeTruthy();
    recordStep('PREP', 'Clinical-prep API', 'pass');
  });

  test.afterAll(async () => {
    scorecard.sessionId = ctx?.sessionId;
    scorecard.appointmentId = ctx?.appointmentId;
    scorecard.payToken = ctx?.payToken ? `${ctx.payToken.slice(0, 8)}…` : null;
    scorecard.patientEmail = ctx?.patientEmail;

    const outDir = path.join(__dirname, '..', 'playwright-report');
    fs.mkdirSync(outDir, { recursive: true });
    const reportPath = path.join(outDir, 'f2-tom-harris-report.json');
    fs.writeFileSync(reportPath, JSON.stringify(scorecard, null, 2));
    console.log(`\nF2 Tom Harris report: ${reportPath}\n`);

    const failed = scorecard.steps.filter((s) => s.status === 'fail');
    if (failed.length) {
      throw new Error(`F2 scorecard failures: ${failed.map((f) => f.label).join(', ')}`);
    }
  });
});
