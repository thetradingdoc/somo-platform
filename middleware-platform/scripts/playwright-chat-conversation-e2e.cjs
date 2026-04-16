#!/usr/bin/env node
'use strict';
/* eslint-disable no-console */
/**
 * E2E: full typed chat with Kelly — open #assistant/chat, send two user turns, assert
 * each POST /landing-assistant/turn succeeds and a new assistant bubble appears.
 *
 * Prereqs:
 *   - Middleware on MIDDLEWARE_API_BASE (default http://127.0.0.1:4000) with Kelly/turn enabled
 *   - UI (CRA :3000 or static build) with REACT_APP_API_BASE pointing at that middleware
 *
 *   UI_BASE_URL=http://127.0.0.1:3000 MIDDLEWARE_API_BASE=http://127.0.0.1:4000 \
 *     node scripts/playwright-chat-conversation-e2e.cjs
 *
 * Debug / headed (browser window; OS may route audio from Chromium):
 *   HEADFUL=1 SANDBOX_DEBUG=1 npm run test:e2e-chat-conversation
 * Optional: PW_SLOW_MO=250 to slow actions. See also DEBUG=pw:api
 */

const { chromium } = require('playwright');

const BASE_URL = String(process.env.UI_BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const MIDDLEWARE_API_BASE = String(process.env.MIDDLEWARE_API_BASE || 'http://127.0.0.1:4000').replace(/\/$/, '');
const HEADFUL = ['1', 'true', 'yes'].includes(String(process.env.HEADFUL || '').trim().toLowerCase());
const SANDBOX_DEBUG = ['1', 'true', 'yes'].includes(
  String(process.env.SANDBOX_DEBUG || process.env.E2E_DEBUG || '').trim().toLowerCase()
);
const PW_SLOW_MO = Math.max(0, Number(process.env.PW_SLOW_MO || 0) || 0);
const TURN_TIMEOUT_MS = Math.min(
  180000,
  Math.max(60000, Number(process.env.CHAT_TURN_TIMEOUT_MS || 120000) || 120000)
);

async function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function assistantBubbleCount(dialog) {
  return dialog.locator('[aria-label="Chat messages"] .axc-bubble--assistant').count();
}

async function userBubbleCount(dialog) {
  return dialog.locator('[aria-label="Chat messages"] .axc-bubble--user').count();
}

/**
 * @param {import('playwright').Page} page
 * @param {import('playwright').Locator} shell
 */
async function sendTurnAndWaitForReply(page, shell, text) {
  const beforeAssistant = await assistantBubbleCount(shell);
  const beforeUser = await userBubbleCount(shell);

  const input = shell.getByRole('textbox', { name: 'Message' });
  await input.fill(text);

  const turnPromise = page.waitForResponse(
    (r) =>
      r.request().method() === 'POST' &&
      /\/api\/public\/landing-assistant\/turn\b/.test(r.url()) &&
      r.status() < 500,
    { timeout: TURN_TIMEOUT_MS }
  );

  await shell.getByRole('button', { name: 'Send' }).click();

  const res = await turnPromise;
  const status = res.status();
  let body = {};
  try {
    body = await res.json();
  } catch (_) {}

  if (status >= 400 || body.success === false) {
    throw new Error(
      `turn failed: HTTP ${status} ${body.error || body.message || JSON.stringify(body).slice(0, 200)}`
    );
  }

  await page.waitForFunction(
    ({ prevA, prevU }) => {
      const log = document.querySelector('[aria-label="Chat messages"]');
      if (!log) return false;
      const a = log.querySelectorAll('.axc-bubble--assistant').length;
      const u = log.querySelectorAll('.axc-bubble--user').length;
      return u > prevU && a > prevA;
    },
    { prevA: beforeAssistant, prevU: beforeUser },
    { timeout: TURN_TIMEOUT_MS }
  );

  await wait(400);
}

async function run() {
  const health = await fetch(`${MIDDLEWARE_API_BASE}/health`).catch(() => null);
  if (!health || !health.ok) {
    console.error('[playwright-chat-conversation-e2e] middleware not reachable at', MIDDLEWARE_API_BASE);
    process.exit(1);
  }

  const launchOpts = {
    headless: !HEADFUL,
    slowMo: PW_SLOW_MO || undefined,
    devtools: HEADFUL && String(process.env.PW_DEVTOOLS || '').trim() === '1'
  };
  const browser = await chromium.launch(launchOpts);
  const page = await browser.newPage();
  page.setDefaultTimeout(60000);

  const out = {
    ok: false,
    base_url: BASE_URL,
    middleware: MIDDLEWARE_API_BASE,
    headful: HEADFUL,
    sandbox_debug: SANDBOX_DEBUG,
    tts_stream: [],
    turns: [],
    error: null
  };

  if (SANDBOX_DEBUG) {
    page.on('console', (msg) => {
      try {
        console.log('[browser console]', msg.type(), msg.text());
      } catch (_) {}
    });
    page.on('pageerror', (err) => {
      console.log('[browser pageerror]', err?.message || err);
    });
  }
  page.on('response', (res) => {
    try {
      const u = res.url();
      if (!/\/api\/public\/landing-assistant\/tts-stream\b/.test(u)) return;
      const row = { status: res.status(), url: u.slice(0, 120) };
      out.tts_stream.push(row);
      if (SANDBOX_DEBUG || HEADFUL) {
        console.log('[e2e] tts-stream response', row.status);
      }
    } catch (_) {}
  });

  try {
    await page.goto(`${BASE_URL}/#assistant/chat`, { waitUntil: 'domcontentloaded' });

    const shell = page.getByRole('dialog', { name: /Skin and Care assistant — chat/i });
    await shell.waitFor({ state: 'visible', timeout: 30000 });

    await shell.getByRole('textbox', { name: 'Message' }).waitFor({ state: 'visible', timeout: 15000 });

    const opener = await shell.evaluate(() => {
      const log = document.querySelector('[aria-label="Chat messages"]');
      if (!log) return '';
      const first = log.querySelector('.axc-bubble--assistant p');
      return first ? String(first.textContent || '').trim().slice(0, 80) : '';
    });
    out.opener_preview = opener;

    const t1 = 'Say hello in one short sentence.';
    await sendTurnAndWaitForReply(page, shell, t1);
    out.turns.push({ user: t1, ok: true });

    const t2 = 'In one sentence, what does sunscreen do for skin?';
    await sendTurnAndWaitForReply(page, shell, t2);
    out.turns.push({ user: t2, ok: true });

    const transcripts = await shell.evaluate(() => {
      const log = document.querySelector('[aria-label="Chat messages"]');
      if (!log) return { assistant: [], user: [] };
      const assistant = Array.from(log.querySelectorAll('.axc-bubble--assistant p')).map((p) =>
        String(p.textContent || '').trim().slice(0, 160)
      );
      const user = Array.from(log.querySelectorAll('.axc-bubble--user p')).map((p) =>
        String(p.textContent || '').trim().slice(0, 160)
      );
      return { assistant, user };
    });
    out.transcript = transcripts;
    out.assistant_reply_count = transcripts.assistant?.length || 0;
    out.user_message_count = transcripts.user?.length || 0;

    if (out.assistant_reply_count < 3) {
      throw new Error(`expected at least 3 assistant bubbles (opener + 2 replies), got ${out.assistant_reply_count}`);
    }
    if (out.user_message_count < 2) {
      throw new Error(`expected 2 user bubbles, got ${out.user_message_count}`);
    }

    out.ok = true;
  } catch (e) {
    out.error = e?.message || String(e);
  }

  console.log(JSON.stringify(out, null, 2));
  await browser.close();
  process.exit(out.ok ? 0 : 1);
}

run().catch((e) => {
  console.error('[playwright-chat-conversation-e2e] FAIL', e?.message || e);
  process.exit(1);
});
