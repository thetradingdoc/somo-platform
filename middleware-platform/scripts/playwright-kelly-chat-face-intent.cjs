#!/usr/bin/env node
'use strict';
/* eslint-disable no-console */
/**
 * E2E (browser): open Skin & Care chat, send "describe my face", assert Kelly does not
 * return the deterministic Step-1 skin-type clarifier (middleware: _defersStep1SkinTypeClarifier).
 *
 * ## What “failing” means
 * - The script **exits 1** if the **latest** assistant bubble still matches the exact
 *   “Quick check so I can personalize…” line. That means either:
 *   1. The middleware running behind `REACT_APP_API_BASE` / your UI is **old** (no deferral fix), or
 *   2. The UI is not talking to the server you think (wrong API URL / cached bundle).
 * - The script **exits 0** when that exact line is **not** the last reply (LLM path ran).
 *
 * Prereqs: middleware with the fix, CRA pointing at it, e.g. `REACT_APP_API_BASE=http://localhost:4000`.
 *
 *   UI_BASE_URL=http://127.0.0.1:3000 node scripts/playwright-kelly-chat-face-intent.cjs
 */

const { chromium } = require('playwright');

const BASE_URL = String(process.env.UI_BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
/** Deterministic Kelly Step-1 line (substring match — exact punctuation from server). */
const SKIN_TYPE_CLARIFY_CORE =
  /Quick check so I can personalize this: would you describe your skin as oily, dry, combination, sensitive, or normal/i;

async function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Last assistant text inside the chat dialog only (avoids stray .axc-bubble nodes elsewhere). */
async function lastAssistantInDialog(page, dialog) {
  return dialog.evaluate(() => {
    const log = document.querySelector('[aria-label="Chat messages"]');
    if (!log) return '';
    const ps = log.querySelectorAll('.axc-bubble--assistant p');
    const last = ps[ps.length - 1];
    return last ? String(last.textContent || '').trim() : '';
  });
}

async function run() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(90000);

  const out = {
    ok: false,
    base_url: BASE_URL,
    last_assistant_snippet: '',
    assistant_messages_sample: [],
    error: null,
    note:
      'If this fails with the skin-type line, restart middleware with kelly-agent-service deferral and confirm the UI uses that API (REACT_APP_API_BASE).'
  };

  try {
    const turnPromise = page.waitForResponse(
      (r) =>
        r.request().method() === 'POST' &&
        /\/api\/public\/landing-assistant\/turn\b/.test(r.url()) &&
        r.status() < 500,
      { timeout: 75000 }
    );

    await page.goto(`${BASE_URL}/#assistant/chat`, { waitUntil: 'domcontentloaded' });
    const shell = page.getByRole('dialog', { name: /Skin and Care assistant — chat/i });
    await shell.waitFor({ state: 'visible', timeout: 25000 });

    const input = shell.getByRole('textbox', { name: 'Message' });
    await input.waitFor({ state: 'visible' });
    await input.fill('describe my face');
    await shell.getByRole('button', { name: 'Send' }).click();

    const turnRes = await turnPromise;
    out.turn_http_status = turnRes.status();
    try {
      const body = await turnRes.json();
      out.reply_preview = String(body?.reply || '').slice(0, 200);
    } catch (_) {
      out.reply_preview = null;
    }

    // Let React append the assistant bubble after JSON is handled.
    await wait(800);
    let lastAssistant = await lastAssistantInDialog(page, shell);
    let stable = 0;
    for (let i = 0; i < 15; i++) {
      await wait(400);
      const next = await lastAssistantInDialog(page, shell);
      if (next === lastAssistant) stable += 1;
      else {
        lastAssistant = next;
        stable = 0;
      }
      if (stable >= 2) break;
    }

    out.last_assistant_snippet = lastAssistant.slice(0, 400);

    out.assistant_messages_sample = await shell.evaluate(() => {
      const log = document.querySelector('[aria-label="Chat messages"]');
      if (!log) return [];
      return Array.from(log.querySelectorAll('.axc-bubble--assistant p')).map((p) =>
        String(p.textContent || '').trim().slice(0, 120)
      );
    });

    if (SKIN_TYPE_CLARIFY_CORE.test(lastAssistant)) {
      out.error =
        'Last assistant message is still the Step-1 skin-type clarifier. Deploy middleware with _defersStep1SkinTypeClarifier, or point the UI at that server.';
    } else {
      out.ok = true;
    }
  } catch (e) {
    out.error = e?.message || String(e);
  }

  console.log(JSON.stringify(out, null, 2));
  await browser.close();
  process.exit(out.ok ? 0 : 1);
}

run().catch((e) => {
  console.error('[playwright-kelly-chat-face-intent] FAIL', e?.message || e);
  process.exit(1);
});
