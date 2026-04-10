#!/usr/bin/env node
'use strict';
/* eslint-disable no-console */

const { chromium } = require('playwright');

const BASE_URL = String(process.env.UI_BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const BARCODE = String(process.env.BEAUTYFACTS_BARCODE || '3337875696548').trim();

async function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function forceClick(locator) {
  await locator.click({ force: true });
}

async function readVideoDiagnostics(page) {
  return page.evaluate(() => {
    const v = document.querySelector('video.axv-scan-hero');
    if (!v) return { found: false };
    const s = v.srcObject;
    const tracks = s && typeof s.getVideoTracks === 'function' ? s.getVideoTracks() : [];
    return {
      found: true,
      readyState: v.readyState,
      paused: v.paused,
      currentTime: Number(v.currentTime || 0),
      width: Number(v.videoWidth || 0),
      height: Number(v.videoHeight || 0),
      hasRenderableFrame: Number(v.videoWidth || 0) > 0 && Number(v.videoHeight || 0) > 0 && Number(v.currentTime || 0) > 0,
      tracks: tracks.map((t) => ({
        enabled: !!t.enabled,
        muted: !!t.muted,
        readyState: String(t.readyState || ''),
        label: String(t.label || '')
      }))
    };
  });
}

async function getAssistantMessages(page) {
  return page.locator('.axc-bubble--assistant p').allTextContents();
}

async function run() {
  const browser = await chromium.launch({
    headless: true,
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream']
  });
  const context = await browser.newContext({ permissions: ['camera', 'microphone'] });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);

  const out = {
    barcode_used: BARCODE,
    video_first_toggle: null,
    video_second_toggle: null,
    scan: { success: false, reason: '' },
    conversation: { success: false, reason: '' },
    links: {
      scan_page: '',
      chat_page: '',
      results_page: ''
    },
    debug: {
      url_after_entry: '',
      visible_buttons: []
    }
  };

  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  const tryNow = page.getByText('Try now', { exact: true });
  const startAnalysis = page.getByText('Start Analysis', { exact: true });
  if (await tryNow.isVisible().catch(() => false)) {
    await forceClick(tryNow);
  } else if (await startAnalysis.isVisible().catch(() => false)) {
    await forceClick(startAnalysis);
  } else {
    throw new Error('Could not find Try now / Start Analysis entry CTA');
  }
  await wait(1200);
  const allowStart = page.getByRole('button', { name: /allow camera.*start|allow camera & start/i });
  if (await allowStart.isVisible().catch(() => false)) {
    await forceClick(allowStart);
    await wait(1200);
  }
  out.debug.url_after_entry = page.url();
  out.debug.visible_buttons = (await page.locator('button').allTextContents()).map((x) => String(x || '').trim()).filter(Boolean).slice(0, 40);

  const startCam = page.getByRole('button', { name: /start camera/i });
  if (await startCam.isVisible().catch(() => false)) {
    await forceClick(startCam);
    await wait(1000);
  }

  const videoToggle = page.getByRole('button', { name: /video on|video off/i });
  if (await videoToggle.isVisible().catch(() => false)) {
    // First toggle ON
    await forceClick(videoToggle);
    await wait(2200);
    out.video_first_toggle = await readVideoDiagnostics(page);
    // Toggle OFF and back ON
    await forceClick(videoToggle);
    await wait(500);
    await forceClick(videoToggle);
    await wait(2200);
    out.video_second_toggle = await readVideoDiagnostics(page);
  } else {
    out.video_first_toggle = { found: false, reason: 'video_toggle_not_visible' };
    out.video_second_toggle = { found: false, reason: 'video_toggle_not_visible' };
  }

  // Scan feature: open scan and use manual barcode input, then run analysis so results are non-dummy.
  const scanBtn = page.getByRole('button', { name: /^scan$/i });
  if (await scanBtn.isVisible().catch(() => false)) {
    await forceClick(scanBtn);
    await wait(500);
    const barcodeInput = page.getByPlaceholder('Enter barcode (8–14 digits)');
    if (await barcodeInput.isVisible().catch(() => false)) {
      await barcodeInput.fill(BARCODE);
      await forceClick(page.getByRole('button', { name: /^lookup$/i }));
      await wait(3500);
      const pageText = await page.locator('body').innerText();
      if (/I found this product|Product detected|Analyze for my skin|Analyze with partial profile/i.test(pageText)) {
        out.scan.success = true;
        out.links.scan_page = page.url();
        const analyzeBtn = page.getByRole('button', {
          name: /analyze for my skin|analyze with partial profile/i
        });
        if (await analyzeBtn.isVisible().catch(() => false) && !(await analyzeBtn.isDisabled().catch(() => true))) {
          await forceClick(analyzeBtn);
          await wait(8000);
        }
      } else {
        out.scan.reason = 'no_product_confirmation_text';
      }
    } else {
      out.scan.reason = 'barcode_input_not_visible';
    }
  } else {
    out.scan.reason = 'scan_button_not_visible';
  }

  // E2E conversation
  const openChat = page.getByRole('button', { name: /open chat/i });
  if (await openChat.isVisible().catch(() => false)) {
    await forceClick(openChat);
    await wait(600);
    out.links.chat_page = page.url();
    const input = page.getByRole('textbox', { name: /message/i });
    await input.fill('I have acne and I currently use a retinoid and a vitamin C serum. Can you help me adjust my routine safely?');
    await forceClick(page.getByRole('button', { name: /send/i }));
    await wait(5000);
    const assistantMsgs = await getAssistantMessages(page);
    const joined = assistantMsgs.join('\n');
    if (/retinoid|vitamin c|acne|routine|sensitive|irritation/i.test(joined)) {
      out.conversation.success = true;
    } else {
      out.conversation.reason = 'assistant_reply_missing_expected_context';
    }
  } else {
    out.conversation.reason = 'open_chat_button_not_visible';
  }

  // Try to open results page hash (if generated route available)
  await page.goto(`${BASE_URL}/#assistant/results`, { waitUntil: 'domcontentloaded' });
  await wait(800);
  if (/assistant\/results/.test(page.url())) {
    out.links.results_page = page.url();
  }

  console.log(JSON.stringify(out, null, 2));
  await browser.close();
}

run().catch((e) => {
  console.error('[playwright-trynow-e2e] FAIL', e?.message || e);
  process.exit(1);
});

