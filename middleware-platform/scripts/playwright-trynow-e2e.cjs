#!/usr/bin/env node
'use strict';
/* eslint-disable no-console */
/**
 * E2E: Try Now → session → Video On → assert camera `<video>` has frames (Playwright fake media).
 *
 * Prereqs: middleware on :4000 with LiveKit env; UI on :3000 (CRA) or :5199 (static serve).
 *
 *   UI_BASE_URL=http://127.0.0.1:3000 MIDDLEWARE_API_BASE=http://127.0.0.1:4000 node scripts/playwright-trynow-e2e.cjs
 */

const { chromium } = require('playwright');

const BASE_URL = String(process.env.UI_BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');

async function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function forceClick(locator) {
  await locator.click({ force: true });
}

function assistantDialog(page) {
  return page.getByRole('dialog', { name: /Skin and Care assistant/i });
}

async function readVideoDiagnostics(page) {
  return page.evaluate(() => {
    const v = document.querySelector('video.axv-scan-hero');
    if (!v) return { found: false, reason: 'no_axv_scan_hero' };
    const s = v.srcObject;
    const tracks = s && typeof s.getVideoTracks === 'function' ? s.getVideoTracks() : [];
    return {
      found: true,
      readyState: v.readyState,
      paused: v.paused,
      currentTime: Number(v.currentTime || 0),
      width: Number(v.videoWidth || 0),
      height: Number(v.videoHeight || 0),
      hasRenderableFrame: Number(v.videoWidth || 0) >= 8 && Number(v.videoHeight || 0) >= 8,
      tracks: tracks.map((t) => ({
        enabled: !!t.enabled,
        muted: !!t.muted,
        readyState: String(t.readyState || ''),
        label: String(t.label || '')
      }))
    };
  });
}

async function run() {
  const browser = await chromium.launch({
    headless: true,
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream']
  });
  const context = await browser.newContext({ permissions: ['camera', 'microphone'] });
  const page = await context.newPage();
  page.setDefaultTimeout(25000);

  const out = {
    ok: false,
    base_url: BASE_URL,
    steps: [],
    video_after_allow: null,
    video_after_video_on: null,
    error: null
  };

  try {
    await page.goto(`${BASE_URL}/#assistant/voice`, { waitUntil: 'domcontentloaded' });
    out.steps.push('goto_voice_hash');

    const shell = assistantDialog(page);
    const allowStart = shell.getByRole('button', { name: /allow camera/i });
    await allowStart.waitFor({ state: 'visible', timeout: 20000 });
    await forceClick(allowStart);
    out.steps.push('clicked_allow_camera');
    await wait(2000);

    out.video_after_allow = await readVideoDiagnostics(page);

    const videoToggle = shell.getByRole('button', { name: /video on|video off/i });
    await videoToggle.waitFor({ state: 'visible', timeout: 15000 });
    const label = (await videoToggle.textContent()) || '';
    if (/video off/i.test(label)) {
      await forceClick(videoToggle);
      out.steps.push('clicked_video_on');
    } else {
      out.steps.push('video_already_on_or_unexpected_label:' + String(label).trim());
    }
    await wait(3500);

    out.video_after_video_on = await readVideoDiagnostics(page);

    const v = out.video_after_video_on;
    out.ok = !!(v && v.found && v.hasRenderableFrame);
    if (!out.ok) {
      out.error = 'video_missing_or_zero_dimensions';
    }
  } catch (e) {
    out.error = e?.message || String(e);
  }

  console.log(JSON.stringify(out, null, 2));
  await browser.close();
  if (!out.ok) {
    process.exit(1);
  }
}

run().catch((e) => {
  console.error('[playwright-trynow-e2e] FAIL', e?.message || e);
  process.exit(1);
});
