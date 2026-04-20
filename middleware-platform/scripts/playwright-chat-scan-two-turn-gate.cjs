#!/usr/bin/env node
'use strict';
/* eslint-disable no-console */

const { randomUUID } = require('crypto');
const { chromium } = require('playwright');

const UI_BASE_URL = String(process.env.UI_BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const API_BASE = String(process.env.MIDDLEWARE_API_BASE || 'http://127.0.0.1:4000').replace(/\/$/, '');
const TURN_TIMEOUT_MS = Math.min(
  180000,
  Math.max(60000, Number(process.env.CHAT_TURN_TIMEOUT_MS || 120000) || 120000)
);
/* Results UI: `data-testid="arp-reasoning-state-banner"` exposes pending/fallback for reasoning lifecycle E2E. */

async function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function postScanContext(sessionId) {
  const payload = {
    session_id: sessionId,
    type: 'barcode_product_context',
    text: '[Barcode Scan] Orange Juice (0000000000000)\nCategory Route: food\nIngredients: 100% orange juice',
    product_data: {
      barcode: '0000000000000',
      product_name: 'Orange Juice',
      ingredients_text: '100% orange juice',
      category_route: 'food',
      category_route_source: 'test_seed'
    }
  };
  const res = await fetch(`${API_BASE}/api/public/landing-assistant/thread-event`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`thread-event failed: HTTP ${res.status} ${body.slice(0, 200)}`);
  }
}

async function sendTurnAndWait(page, shell, text) {
  const beforeAssistant = await shell.locator('[aria-label="Chat messages"] .axc-bubble--assistant').count();
  const beforeUser = await shell.locator('[aria-label="Chat messages"] .axc-bubble--user').count();
  const input = shell.getByRole('textbox', { name: 'Message' });
  await input.waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForFunction(() => {
    const el = document.querySelector('[aria-label="Message"]');
    return !!el && !el.hasAttribute('disabled');
  }, null, { timeout: TURN_TIMEOUT_MS });
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
  const body = await res.json().catch(() => ({}));
  if (res.status() >= 400 || body.success === false) {
    throw new Error(`turn failed: HTTP ${res.status()} ${body.error || body.message || ''}`);
  }
  await page.waitForFunction(
    ({ prevA, prevU }) => {
      const log = document.querySelector('[aria-label="Chat messages"]');
      if (!log) return false;
      const a = log.querySelectorAll('.axc-bubble--assistant').length;
      const u = log.querySelectorAll('.axc-bubble--user').length;
      return a > prevA && u > prevU;
    },
    { prevA: beforeAssistant, prevU: beforeUser },
    { timeout: TURN_TIMEOUT_MS }
  );
  await wait(400);
}

async function run() {
  const healthUi = await fetch(UI_BASE_URL).catch(() => null);
  const healthApi = await fetch(`${API_BASE}/health`).catch(() => null);
  if (!healthUi || !healthUi.ok) {
    throw new Error(`UI unavailable at ${UI_BASE_URL}`);
  }
  if (!healthApi || !healthApi.ok) {
    throw new Error(`API unavailable at ${API_BASE}`);
  }

  const sessionId = `pw_scan_${randomUUID()}`;
  await postScanContext(sessionId);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  await context.addInitScript((sid) => {
    try {
      window.sessionStorage.setItem('littlelab_landing_assistant_sid', sid);
    } catch (_) {}
  }, sessionId);
  const page = await context.newPage();
  page.setDefaultTimeout(60000);

  const out = {
    ok: false,
    session_id: sessionId,
    ui_base_url: UI_BASE_URL,
    api_base: API_BASE,
    turns: [],
    transcript: { assistant: [], user: [] },
    error: null
  };

  try {
    await page.goto(`${UI_BASE_URL}/#assistant/chat`, { waitUntil: 'domcontentloaded' });
    const shell = page.getByRole('dialog', { name: /Skin and Care assistant — chat/i });
    await shell.waitFor({ state: 'visible', timeout: 30000 });

    const turn1 = 'For this scanned product, what does low risk mean versus generally safe for children?';
    const turn2 = 'Give one short practical takeaway for a parent.';
    await sendTurnAndWait(page, shell, turn1);
    out.turns.push({ user: turn1, ok: true });
    await sendTurnAndWait(page, shell, turn2);
    out.turns.push({ user: turn2, ok: true });

    out.transcript = await shell.evaluate(() => {
      const log = document.querySelector('[aria-label="Chat messages"]');
      if (!log) return { assistant: [], user: [] };
      const assistant = Array.from(log.querySelectorAll('.axc-bubble--assistant p')).map((p) =>
        String(p.textContent || '').trim()
      );
      const user = Array.from(log.querySelectorAll('.axc-bubble--user p')).map((p) =>
        String(p.textContent || '').trim()
      );
      return { assistant, user };
    });

    const assistantText = out.transcript.assistant.join('\n');
    if (/oily,\s*dry,\s*combination,\s*sensitive,\s*or\s*normal/i.test(assistantText)) {
      throw new Error('scan gate failed: skin-type clarifier appeared in scan chat transcript');
    }
    if (out.transcript.user.length < 2) {
      throw new Error(`scan gate failed: expected 2 user turns, got ${out.transcript.user.length}`);
    }
    out.ok = true;
  } catch (e) {
    out.error = e?.message || String(e);
  }

  console.log(JSON.stringify(out, null, 2));
  await context.close();
  await browser.close();
  process.exit(out.ok ? 0 : 1);
}

run().catch((e) => {
  console.error('[playwright-chat-scan-two-turn-gate] FAIL', e?.message || e);
  process.exit(1);
});
