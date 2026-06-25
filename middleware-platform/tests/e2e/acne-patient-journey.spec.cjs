'use strict';

/**
 * Acne + TikTok routine journey — **full browser** chat (8 turns) + deterministic eval-engine.
 * Uses the same UI as users: `/#assistant/chat` → type → Send → real `fetch` to middleware.
 *
 * Prereqs:
 * - Middleware on PW_API_BASE_URL (default http://127.0.0.1:4000), `/health` OK
 * - `npx playwright install` (Chromium)
 * - Landing build that includes `landingAssistantApi` static-serve fix (port 5199 → :4000), or set REACT_APP_API_BASE at build time
 *
 * Run (from middleware-platform):
 *   (cd ../unified-dashboard/littlelab-landing && npm run build) && npm run test:e2e-acne-journey
 *
 * API-only regression (no browser): ACNE_JOURNEY_INCLUDE_API=1 npm run test:e2e-acne-journey:api
 *
 * HTML: middleware-platform/test-results/acne-journey-report.html
 */

const { test, expect } = require('@playwright/test');
const { randomUUID } = require('crypto');
const fs = require('fs');
const path = require('path');
const { evaluateFullJourney, renderAcneJourneyHtml } = require('./eval-engine');

const API_BASE = (process.env.PW_API_BASE_URL || process.env.PW_BASE_URL || 'http://127.0.0.1:4000').replace(
  /\/$/,
  ''
);
const CLINIC_ID = String(
  process.env.DEFAULT_CLINIC_ID || process.env.SMOKE_CLINIC_ID || 'clinic-default'
).trim();

/** Real EANs used elsewhere in repo / OBF docs so BeautyFacts + chat barcode capture can resolve. */
const BARCODE_A = String(process.env.ACNE_JOURNEY_BARCODE_A || '3337875696548').trim();
const BARCODE_B = String(process.env.ACNE_JOURNEY_BARCODE_B || '3574669909594').trim();

const PATIENT_TURNS = [
  "Hi, I've been dealing with acne for years and I want a full skin transformation — clear, even tone, not just spot treatment.",
  `I saw this girl on TikTok and her skin completely transformed — she's using a retinoid, snail mucin, and a vitamin C serum. I bought similar products; two boxes show EAN barcodes ${BARCODE_A} and ${BARCODE_B} on the label.`,
  "I bought the same three and I've been layering them all at night, thinnest to thickest — snail, then vitamin C, then the retinoid. That's okay, right?",
  "Wait — everyone on TikTok stacks them and they look fine. Are you sure that's dangerous? Maybe it's fine for some people?",
  "Okay if I shouldn't layer them, what exactly should my morning versus night routine look like? Be specific.",
  'Can you explain the science in plain English — why vitamin C and retinoid together at night is a problem?',
  "I'm also on prescription tretinoin from my derm — does that change anything with the vitamin C?",
  'Can you give me a structured problem → solution report for my whole situation — concerns, conflicts, and a week-one plan?',
];

async function isMiddlewareReachable(request) {
  try {
    const r = await request.get(`${API_BASE}/health`, { timeout: 5000 });
    return r.ok();
  } catch {
    return false;
  }
}

async function postTurn(request, sessionId, message) {
  const res = await request.post(`${API_BASE}/api/public/landing-assistant/turn`, {
    data: {
      message,
      session_id: sessionId,
      clinic_id: CLINIC_ID,
      kelly_flow: 'skincare',
    },
    headers: { 'Content-Type': 'application/json' },
    timeout: 120_000,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { _raw: text.slice(0, 500) };
  }
  return { res, json, text };
}

function writeHtmlReport(outDir, html) {
  fs.mkdirSync(outDir, { recursive: true });
  const p = path.join(outDir, 'acne-journey-report.html');
  fs.writeFileSync(p, html, 'utf8');
  return p;
}

async function attachEvalArtifacts(testInfo, turns, sessionLabel) {
  const evalBundle = evaluateFullJourney(turns);
  const html = renderAcneJourneyHtml({
    turns,
    evalBundle,
    sessionId: sessionLabel,
    apiBase: API_BASE,
  });
  const reportPath = writeHtmlReport(path.join(__dirname, '..', '..', 'test-results'), html);

  await testInfo.attach('acne-journey-eval.json', {
    body: JSON.stringify({ aggregate: evalBundle.aggregate, results: evalBundle.results }, null, 2),
    contentType: 'application/json',
  });
  await testInfo.attach('acne-journey-report.html', {
    body: Buffer.from(html, 'utf8'),
    contentType: 'text/html',
  });

  const strict = process.env.ACNE_JOURNEY_STRICT === '1';
  if (!strict) {
    await testInfo.attach('acne-journey-mode.txt', {
      body:
        'Default diagnostic mode: soft gates. Set ACNE_JOURNEY_STRICT=1 for zero critical failures, overall ≥55, and mandatory T3 conflict surfacing.',
      contentType: 'text/plain',
    });
  }

  if (strict) {
    expect(evalBundle.aggregate.critical_failure_count, 'Strict: no TikTok softening / RX misses').toBe(0);
    expect(evalBundle.aggregate.overall_accuracy).toBeGreaterThanOrEqual(55);
    expect(evalBundle.results[2].details.conflict_detected, 'Strict: turn 3 must surface conflict').toBe(true);
  } else {
    expect(evalBundle.aggregate.overall_accuracy).toBeGreaterThanOrEqual(40);
    expect(evalBundle.aggregate.critical_failure_count).toBeLessThanOrEqual(2);
  }

  return { evalBundle, reportPath };
}

/**
 * Wait until a new assistant bubble appears after send (text may repeat, e.g. identical "Failed to fetch").
 */
async function sendChatTurn(page, message) {
  const composer = page.locator('.axc-composer');
  const input = composer.getByRole('textbox', { name: /message/i });
  const sendBtn = composer.getByRole('button', { name: /^send$/i });

  const assistantCount = () => page.locator('.axc-bubble--assistant').count();

  const lastAssistantText = async () => {
    const p = page.locator('.axc-bubble--assistant').last().locator('p');
    if ((await p.count()) === 0) return '';
    return (await p.innerText()).trim();
  };

  const nBefore = await assistantCount();
  await input.fill(message);
  await sendBtn.click();
  await expect(input).toBeEnabled({ timeout: 120_000 });

  await expect
    .poll(async () => assistantCount(), { timeout: 120_000, intervals: [400, 800, 1200] })
    .toBeGreaterThan(nBefore);

  const reply = (await lastAssistantText()).trim();
  expect(
    reply.length > 12,
    `Assistant reply too short or empty (middleware reachable? got: ${reply.slice(0, 120)})`
  ).toBeTruthy();

  if (/failed to fetch|could not reach the assistant/i.test(reply)) {
    throw new Error(
      `Browser could not reach middleware from ${API_BASE} (CORS, SSL, or server down). ` +
        `Start middleware on :4000 and allow origin http://127.0.0.1:5199. Raw: ${reply.slice(0, 200)}`
    );
  }

  return reply;
}

test.describe('Acne patient journey — browser (full UI)', () => {
  test.setTimeout(300_000);

  test('8-turn chat through Skin & Care UI + eval report', async ({ page, request }, testInfo) => {
    test.skip(!(await isMiddlewareReachable(request)), `Middleware not up at ${API_BASE}`);

    await page.goto('/#assistant/chat', { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await expect(page.locator('.ax-shell')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('textbox', { name: /message/i })).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('.axc-bubble--assistant').first()).toBeVisible({ timeout: 90_000 });

    const transcript = [];
    let idx = 0;
    for (const message of PATIENT_TURNS) {
      idx += 1;
      await test.step(`Turn ${idx} (browser): ${message.slice(0, 72)}${message.length > 72 ? '…' : ''}`, async () => {
        const reply = await sendChatTurn(page, message);
        expect(reply.length).toBeGreaterThan(10);
        transcript.push({ role: 'user', text: message });
        transcript.push({ role: 'assistant', text: reply });
      });
    }

    await testInfo.attach('acne-journey-browser-transcript.json', {
      body: JSON.stringify(transcript, null, 2),
      contentType: 'application/json',
    });

    const sid =
      (await page.evaluate(() => {
        try {
          return sessionStorage.getItem('littlelab_landing_assistant_sid') || '';
        } catch (_) {
          return '';
        }
      })) || 'browser-session';

    const turns = [];
    for (let i = 0; i < transcript.length; i += 2) {
      turns.push({ patientMessage: transcript[i].text, agentReply: transcript[i + 1].text });
    }

    const { reportPath } = await attachEvalArtifacts(testInfo, turns, sid);

    await test.step('Open Session Result Snapshot (results UI)', async () => {
      await page.goto('/#assistant/results', { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await expect(page.locator('.axr-title')).toContainText(/session result snapshot/i, { timeout: 15_000 });
      const resultsUrl = page.url();
      const linkNote = [
        `Results path (hash only works when a server is listening): ${resultsUrl}`,
        '',
        'Why ERR_CONNECTION_REFUSED: Playwright stops the static server when the test ends. Nothing listens on :5199 until you start it again.',
        '',
        'Option A — same as Playwright (build must exist):',
        '  cd middleware-platform && npm run serve:landing',
        '  Then open: http://127.0.0.1:5199/#assistant/results',
        '',
        'Option B — CRA dev (port 3000):',
        '  cd unified-dashboard/littlelab-landing && REACT_APP_API_BASE=http://127.0.0.1:4000 npm start',
        '  Then open: http://localhost:3000/#assistant/results',
        '',
        `Barcodes in turn 2: ${BARCODE_A}, ${BARCODE_B}`,
        `Session id (sessionStorage key littlelab_landing_assistant_sid): ${sid}`,
        '',
        'Snapshot data is tied to this browser profile/sessionStorage; a new incognito tab will not show the same session.',
      ].join('\n');
      console.log(`\n[acne-journey][browser] RESULTS_UI_URL\n${resultsUrl}\n`);
      await testInfo.attach('results-ui-link.txt', { body: linkNote, contentType: 'text/plain' });
      const linkPath = path.join(__dirname, '..', '..', 'test-results', 'acne-journey-results-ui-url.txt');
      fs.mkdirSync(path.dirname(linkPath), { recursive: true });
      fs.writeFileSync(linkPath, `${linkNote}\n`, 'utf8');
    });

    console.log(`\n[acne-journey][browser] HTML report: ${reportPath}`);
    console.log(`[acne-journey][browser] Results link file: ${path.join(__dirname, '..', '..', 'test-results', 'acne-journey-results-ui-url.txt')}`);
  });
});

if (process.env.ACNE_JOURNEY_INCLUDE_API === '1') {
  test.describe('Acne patient journey — API-only (optional)', () => {
    test.setTimeout(300_000);

    test('8-turn HTTP + eval (no browser)', async ({ request }, testInfo) => {
      test.skip(!(await isMiddlewareReachable(request)), `Middleware not up at ${API_BASE}`);

      const sessionId = randomUUID();
      const transcript = [];
      let idx = 0;
      for (const message of PATIENT_TURNS) {
        idx += 1;
        await test.step(`Turn ${idx} (API): ${message.slice(0, 72)}${message.length > 72 ? '…' : ''}`, async () => {
          const { res, json } = await postTurn(request, sessionId, message);
          expect(res.ok(), `HTTP ${res.status()}: ${JSON.stringify(json).slice(0, 400)}`).toBeTruthy();
          expect(json.success, JSON.stringify(json)).toBe(true);
          expect(json.session_id).toBe(sessionId);
          expect(json.skipped, 'turn must not be dropped').not.toBe(true);
          const reply = String(json.reply || '').trim();
          expect(reply.length).toBeGreaterThan(10);
          transcript.push({ role: 'user', text: message });
          transcript.push({ role: 'assistant', text: reply, toolsUsed: json.toolsUsed || [] });
        });
      }

      const turns = [];
      for (let i = 0; i < transcript.length; i += 2) {
        turns.push({ patientMessage: transcript[i].text, agentReply: transcript[i + 1].text });
      }

      await testInfo.attach('acne-journey-api-transcript.json', {
        body: JSON.stringify(transcript, null, 2),
        contentType: 'application/json',
      });

      const { reportPath } = await attachEvalArtifacts(testInfo, turns, sessionId);
      console.log(`\n[acne-journey][api] HTML report: ${reportPath}`);
    });
  });
}
