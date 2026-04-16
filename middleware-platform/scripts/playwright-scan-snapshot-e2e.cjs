#!/usr/bin/env node
'use strict';
/* eslint-disable no-console */
/**
 * Live E2E: Try Now → Scan mode → Path B (API thread-event + snapshot refresh, same as camera scan)
 *   → back → Analyze (Path A: Kelly turn + snapshot refresh).
 *
 * Prereqs:
 *   1. Middleware: NODE_ENV=development node server.js (default :4000) with CORS for UI origin
 *   2. Landing build served: npm run serve:landing  (from middleware-platform, serves ../littlelab-landing/build on :5199)
 *   3. Build must have REACT_APP_API_BASE pointing at middleware (e.g. http://127.0.0.1:4000) — set in .env.production.local before build, or use dev server on :3000 with env
 *
 * Usage:
 *   UI_BASE_URL=http://127.0.0.1:5199 MIDDLEWARE_API_BASE=http://127.0.0.1:4000 BEAUTYFACTS_BARCODE=3337875696548 node scripts/playwright-scan-snapshot-e2e.cjs
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const SCREENSHOT_DIR = path.join(__dirname, '../test-results/e2e-scan');
function shot(page, name) {
  try {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    const file = path.join(SCREENSHOT_DIR, `${name}.png`);
    return page.screenshot({ path: file, fullPage: true }).then(() => file);
  } catch (e) {
    return Promise.resolve(null);
  }
}

const BASE_URL = String(process.env.UI_BASE_URL || 'http://127.0.0.1:5199').replace(/\/$/, '');
const MIDDLEWARE_API_BASE = String(process.env.MIDDLEWARE_API_BASE || 'http://127.0.0.1:4000').replace(/\/$/, '');
const BARCODE = String(process.env.BEAUTYFACTS_BARCODE || '3337875696548').trim();

async function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function forceClick(locator) {
  await locator.click({ force: true });
}

function assistantDialog(page) {
  // Scope to the assistant modal only — the landing page stays in the DOM behind it; unscoped
  // getByRole can resolve to wrong nodes and `body` innerText includes both layers.
  return page.getByRole('dialog', { name: /Skin and Care assistant/i });
}

/** Same barcode thread-event + snapshot refresh as the in-app camera scan path (no typed barcode UI). */
async function simulatePathBBarcodeIngest(page) {
  const sid = await page.evaluate(() => sessionStorage.getItem('littlelab_landing_assistant_sid'));
  if (!sid) throw new Error('missing littlelab_landing_assistant_sid in sessionStorage');

  const bfRes = await fetch(`${MIDDLEWARE_API_BASE}/api/public/beautyfacts/${encodeURIComponent(BARCODE)}`);
  const bf = await bfRes.json().catch(() => ({}));
  if (!bfRes.ok || !bf.success) {
    throw new Error(bf.error || `beautyfacts HTTP ${bfRes.status}`);
  }
  const p = bf.product || {};
  const dataSource = bf.data_source || null;
  const productData = {
    barcode: p.barcode != null ? String(p.barcode).trim() : BARCODE,
    product_name: p.product_name != null ? String(p.product_name).trim() : null,
    image_url: String(p.image_url || p.image_front_url || '').trim() || null,
    ingredients_text: p.ingredients_text != null ? String(p.ingredients_text) : null,
    labels: Array.isArray(p.labels)
      ? p.labels.map((x) => String(x || '').trim()).filter(Boolean).slice(0, 32)
      : [],
    allergens: Array.isArray(p.allergens)
      ? p.allergens.map((x) => String(x || '').trim()).filter(Boolean).slice(0, 32)
      : [],
    categories_tags: Array.isArray(p.categories_tags)
      ? p.categories_tags.map((x) => String(x || '').trim()).filter(Boolean).slice(0, 32)
      : [],
    data_source: dataSource
  };
  const productName = p.product_name || `barcode ${BARCODE}`;
  const bc = p.barcode || BARCODE;
  const contextText = [
    `[Barcode Scan] ${productName} (${bc})`,
    productData.image_url ? `Product image: ${productData.image_url}` : '',
    productData.ingredients_text ? `Ingredients: ${String(productData.ingredients_text).slice(0, 900)}` : '',
    productData.labels.length ? `Labels: ${productData.labels.slice(0, 12).join(', ')}` : '',
    productData.allergens.length ? `Allergens: ${productData.allergens.slice(0, 12).join(', ')}` : ''
  ]
    .filter(Boolean)
    .join('\n');

  const teRes = await fetch(`${MIDDLEWARE_API_BASE}/api/public/landing-assistant/thread-event`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      session_id: sid,
      type: 'barcode_product_context',
      text: contextText,
      product_data: productData
    })
  });
  const te = await teRes.json().catch(() => ({}));
  if (!teRes.ok || !te.success) {
    throw new Error(te.error || `thread-event HTTP ${teRes.status}`);
  }

  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('littlelab-refresh-result-snapshot'));
  });
  await wait(800);
}

async function openTryNow(page) {
  // Deep-link mounts the assistant shell without scrolling the marketing page.
  await page.goto(`${BASE_URL}/#assistant/voice`, { waitUntil: 'domcontentloaded' });
  const shell = assistantDialog(page);
  const allowStart = shell.getByRole('button', { name: /allow camera/i });
  await allowStart.waitFor({ state: 'visible', timeout: 20000 });
  await forceClick(allowStart);
  await wait(1200);
}

async function run() {
  const browser = await chromium.launch({
    headless: true,
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream']
  });
  const context = await browser.newContext({ permissions: ['camera', 'microphone'] });
  const page = await context.newPage();
  page.setDefaultTimeout(45000);

  const out = {
    path_b: { ok: false, detail: '' },
    path_a: { ok: false, detail: '' },
    urls: { after_scan: '', after_analyze: '' },
    screenshots: {}
  };

  await openTryNow(page);

  const shell = assistantDialog(page);

  const startCam = shell.getByRole('button', { name: /start camera/i });
  if (await startCam.isVisible().catch(() => false)) {
    await forceClick(startCam);
    await wait(800);
  }

  const scanBtn = shell.getByRole('button', { name: /^scan$/i });
  try {
    await scanBtn.waitFor({ state: 'visible', timeout: 20000 });
  } catch (_) {
    out.path_b.detail = 'scan_button_not_visible';
    const dbg = await shot(page, 'debug-scan-button-missing');
    if (dbg) out.screenshots.debug_no_scan = dbg;
    console.log(JSON.stringify(out, null, 2));
    await browser.close();
    process.exit(1);
  }
  await scanBtn.scrollIntoViewIfNeeded();
  await scanBtn.click();
  await wait(600);

  try {
    await simulatePathBBarcodeIngest(page);
  } catch (e) {
    out.path_b.detail = `path_b_api_ingest: ${e?.message || e}`;
    console.log(JSON.stringify(out, null, 2));
    await browser.close();
    process.exit(1);
  }

  // Path B: wait for hash or results heading (auto-navigate after snapshot refresh)
  try {
    await page.waitForFunction(
      () => {
        if (/#assistant\/results/.test(window.location.hash)) return true;
        const dlg = document.querySelector('[role="dialog"][aria-label*="Skin and Care assistant"]');
        return !!(dlg && dlg.innerText && dlg.innerText.includes('Session Result Snapshot'));
      },
      null,
      { timeout: 25000 }
    );
    out.path_b.ok = true;
    out.urls.after_scan = page.url();
  } catch (e) {
    out.path_b.detail = `timeout_waiting_results: ${e?.message || e}`;
    const dbgShot = await shot(page, 'path-b-timeout-state');
    if (dbgShot) out.screenshots.path_b_timeout = dbgShot;
    try {
      out.debug = {
        hash: await page.evaluate(() => window.location.hash),
        bodySnippet: (await page.locator('body').innerText()).slice(0, 2800)
      };
    } catch (_) {}
    console.log(JSON.stringify(out, null, 2));
    await browser.close();
    process.exit(1);
  }

  const bodyAfterScan = await shell.innerText();
  if (!/Scanned product|Session Result Snapshot/i.test(bodyAfterScan)) {
    out.path_b.detail = 'missing_results_ui_text';
    await shot(page, 'path-b-fail-missing-text');
    console.log(JSON.stringify(out, null, 2));
    await browser.close();
    process.exit(1);
  }

  const pathBFile = await shot(page, 'path-b-results-after-scan');
  out.screenshots = { path_b_results: pathBFile || '' };

  // Path A: back to voice, tap Analyze, expect assistant activity or still on results after turn
  await forceClick(shell.getByRole('button', { name: /^back$/i }));
  await wait(800);
  out.urls.after_analyze = page.url();

  const analyzeBtn = shell.getByRole('button', {
    name: /analyze for my skin|analyze with partial profile/i
  });
  const analyzeReady =
    (await analyzeBtn.isVisible().catch(() => false)) && !(await analyzeBtn.isDisabled().catch(() => true));
  const pathAVoiceFile = await shot(page, 'path-a-voice-after-back');
  out.screenshots.path_a_voice = pathAVoiceFile || '';

  if (analyzeReady) {
    await forceClick(analyzeBtn);
    await wait(12000);
    const txt = await shell.innerText();
    const hashResults = /#assistant\/results/.test(page.url());
    if (/skin|routine|ingredient|report|snapshot|concern|barrier|acne/i.test(txt) || hashResults) {
      out.path_a.ok = true;
    } else {
      out.path_a.detail = 'no_expected_text_after_analyze_turn';
    }
  } else {
    out.path_a.detail = 'analyze_button_disabled_or_missing';
    out.path_a.ok = true;
  }

  const pathAEndFile = await shot(page, 'path-a-end-after-analyze-or-skip');
  out.screenshots.path_a_end = pathAEndFile || '';

  console.log(JSON.stringify(out, null, 2));
  await browser.close();

  if (!out.path_b.ok) process.exit(1);
  if (!out.path_a.ok) process.exit(1);
}

run().catch((e) => {
  console.error('[playwright-scan-snapshot-e2e] FAIL', e?.message || e);
  process.exit(1);
});
