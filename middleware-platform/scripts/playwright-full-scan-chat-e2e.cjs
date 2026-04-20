#!/usr/bin/env node
'use strict';
/* eslint-disable no-console */

const { chromium } = require('playwright');

const UI_BASE_URL = String(process.env.UI_BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const API_BASE = String(process.env.MIDDLEWARE_API_BASE || 'http://127.0.0.1:4000').replace(/\/$/, '');
const BARCODE = String(process.env.E2E_SCAN_BARCODE || '0034856008125').trim();
const TURN_TIMEOUT_MS = Math.min(
  180000,
  Math.max(60000, Number(process.env.CHAT_TURN_TIMEOUT_MS || 120000) || 120000)
);

async function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendTurnAndWaitForReply(page, text) {
  const chatRoot = page.getByRole('dialog', { name: /Skin and Care assistant — chat/i });
  const beforeAssistant = await chatRoot.locator('[aria-label="Chat messages"] .axc-bubble--assistant').count();
  const input = chatRoot.getByRole('textbox', { name: 'Message' });
  await input.waitFor({ state: 'visible', timeout: 30000 });
  let sent = false;
  for (let i = 0; i < 8; i += 1) {
    const enabled = await input.isEnabled().catch(() => false);
    if (!enabled) {
      await wait(500);
      continue;
    }
    try {
      await input.fill(text, { timeout: 10000 });
      sent = true;
      break;
    } catch (_) {
      await wait(300);
    }
  }
  if (!sent) throw new Error('chat composer never became enabled for sending');
  const turnPromise = page.waitForResponse(
    (r) =>
      r.request().method() === 'POST' &&
      /\/api\/public\/landing-assistant\/turn\b/.test(r.url()) &&
      r.status() < 500,
    { timeout: TURN_TIMEOUT_MS }
  );
  await chatRoot.getByRole('button', { name: 'Send' }).click();
  const res = await turnPromise;
  const body = await res.json().catch(() => ({}));
  if (res.status() >= 400 || body.success === false) {
    throw new Error(`turn failed: HTTP ${res.status()} ${body.error || body.message || ''}`);
  }
  const assistantBubbles = chatRoot.locator('[aria-label="Chat messages"] .axc-bubble--assistant');
  const started = Date.now();
  while (Date.now() - started < TURN_TIMEOUT_MS) {
    const nowA = await assistantBubbles.count();
    if (nowA > beforeAssistant) break;
    await wait(300);
  }
  const afterA = await assistantBubbles.count();
  if (afterA <= beforeAssistant) {
    throw new Error(`assistant bubble did not advance after turn (before=${beforeAssistant}, after=${afterA})`);
  }
  await wait(400);
}

async function sendTurnAwaitResponseOnly(page, text) {
  const chatRoot = page.getByRole('dialog', { name: /Skin and Care assistant — chat/i });
  const input = chatRoot.getByRole('textbox', { name: 'Message' });
  await input.waitFor({ state: 'visible', timeout: 30000 });
  let sent = false;
  for (let i = 0; i < 8; i += 1) {
    const enabled = await input.isEnabled().catch(() => false);
    if (!enabled) {
      await wait(500);
      continue;
    }
    try {
      await input.fill(text, { timeout: 10000 });
      sent = true;
      break;
    } catch (_) {
      await wait(300);
    }
  }
  if (!sent) throw new Error('chat composer never became enabled for sending');
  const turnPromise = page.waitForResponse(
    (r) =>
      r.request().method() === 'POST' &&
      /\/api\/public\/landing-assistant\/turn\b/.test(r.url()) &&
      r.status() < 500,
    { timeout: TURN_TIMEOUT_MS }
  );
  await chatRoot.getByRole('button', { name: 'Send' }).click();
  const res = await turnPromise;
  const body = await res.json().catch(() => ({}));
  if (res.status() >= 400 || body.success === false) {
    throw new Error(`turn failed: HTTP ${res.status()} ${body.error || body.message || ''}`);
  }
  await wait(600);
}

async function run() {
  const ui = await fetch(UI_BASE_URL).catch(() => null);
  const api = await fetch(`${API_BASE}/health`).catch(() => null);
  if (!ui || !ui.ok) throw new Error(`UI unavailable at ${UI_BASE_URL}`);
  if (!api || !api.ok) throw new Error(`API unavailable at ${API_BASE}`);

  const browser = await chromium.launch({
    headless: true,
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream']
  });
  const context = await browser.newContext({ permissions: ['camera', 'microphone'] });
  const page = await context.newPage();
  page.setDefaultTimeout(60000);

  const out = {
    ok: false,
    ui_base_url: UI_BASE_URL,
    api_base: API_BASE,
    barcode: BARCODE,
    camera_ready: false,
    scan_mode_enabled: false,
    barcode_lookup: null,
    pinned_context: null,
    turns: [],
    transcript: { assistant: [], user: [] },
    error: null
  };

  page.on('response', async (res) => {
    const u = res.url();
    if (!/\/api\/public\/(beautyfacts|foodfacts)\//.test(u)) return;
    let j = {};
    try {
      j = await res.json();
    } catch (_) {}
    out.barcode_lookup = {
      status: res.status(),
      endpoint: u.includes('/foodfacts/') ? 'foodfacts' : 'beautyfacts',
      data_source: j?.data_source || null,
      product_name: j?.product?.product_name || null
    };
  });

  try {
    await page.goto(`${UI_BASE_URL}/#assistant/voice`, { waitUntil: 'domcontentloaded' });
    const voiceShell = page.getByRole('dialog', { name: /Skin and Care assistant/i });
    const allow = voiceShell.getByRole('button', { name: /allow camera/i });
    await allow.waitFor({ state: 'visible', timeout: 30000 });
    await allow.click({ force: true });
    await wait(1200);

    const videoState = await page.evaluate(() => {
      const v = document.querySelector('video.axv-scan-hero');
      if (!v) return { found: false };
      return {
        found: true,
        width: Number(v.videoWidth || 0),
        height: Number(v.videoHeight || 0),
        hasRenderableFrame: Number(v.videoWidth || 0) >= 8 && Number(v.videoHeight || 0) >= 8
      };
    });
    out.camera_ready = !!(videoState.found && videoState.hasRenderableFrame);

    const scanBtn = voiceShell.getByRole('button', { name: /^scan$/i });
    await scanBtn.waitFor({ state: 'visible', timeout: 15000 });
    await scanBtn.click({ force: true });
    out.scan_mode_enabled = true;

    const openChat = voiceShell.getByRole('button', { name: 'Open chat' });
    await openChat.waitFor({ state: 'visible', timeout: 15000 });
    await openChat.click({ force: true });

    const chatShell = page.getByRole('dialog', { name: /Skin and Care assistant — chat/i });
    await chatShell.waitFor({ state: 'visible', timeout: 30000 });

    const scanTurn = `Scan barcode ${BARCODE}`;
    await sendTurnAwaitResponseOnly(page, scanTurn);
    out.turns.push({ user: scanTurn, ok: true });
    await wait(1500);

    const hashAfterScanTurn = await page.evaluate(() => window.location.hash);
    if (/#assistant\/results/i.test(hashAfterScanTurn)) {
      const askKelly = page.getByRole('button', { name: /Ask Kelly/i });
      if (await askKelly.isVisible().catch(() => false)) {
        await askKelly.click({ force: true });
        await page.waitForURL(/#assistant\/chat/i, { timeout: 30000 });
      } else {
        await page.goto(`${UI_BASE_URL}/#assistant/chat`, { waitUntil: 'domcontentloaded' });
      }
      await page.getByRole('dialog', { name: /Skin and Care assistant — chat/i }).waitFor({
        state: 'visible',
        timeout: 30000
      });
    }

    const pinned = chatShell.locator('.axc-chip').first();
    if (await pinned.isVisible().catch(() => false)) {
      out.pinned_context = (await pinned.innerText()).trim();
    }

    const turn2 = 'For this scanned product, what does low risk mean versus generally safe for children?';
    await sendTurnAndWaitForReply(page, turn2);
    out.turns.push({ user: turn2, ok: true });

    const turn3 = 'Give one short practical takeaway for a parent.';
    await sendTurnAndWaitForReply(page, turn3);
    out.turns.push({ user: turn3, ok: true });

    out.transcript = await chatShell.evaluate(() => {
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

    if (!out.camera_ready) throw new Error('camera feed not renderable');
    if (!out.barcode_lookup || out.barcode_lookup.status >= 400) throw new Error('barcode lookup did not complete');
    if (out.transcript.user.length < 3) throw new Error(`expected >=3 user turns, got ${out.transcript.user.length}`);
    if (out.transcript.assistant.length < 4) throw new Error(`expected >=4 assistant turns, got ${out.transcript.assistant.length}`);
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
  console.error('[playwright-full-scan-chat-e2e] FAIL', e?.message || e);
  process.exit(1);
});
