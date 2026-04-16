#!/usr/bin/env node
'use strict';
/* eslint-disable no-console */
/**
 * E2E: assistant voice shell → inject OFF-like barcode thread-event → refresh snapshot →
 * results page shows "Ingredient list" + raw catalog text (food path without skincare chips).
 *
 * Prereqs: middleware on :4000; UI (CRA :3000 or static build on :5199) with API base pointing at middleware.
 *
 *   UI_BASE_URL=http://127.0.0.1:3000 MIDDLEWARE_API_BASE=http://127.0.0.1:4000 \
 *     node scripts/playwright-results-ingredient-list-e2e.cjs
 */

const { chromium } = require('playwright');

const BASE_URL = String(process.env.UI_BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const MIDDLEWARE_API_BASE = String(process.env.MIDDLEWARE_API_BASE || 'http://127.0.0.1:4000').replace(/\/$/, '');

async function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function forceClick(locator) {
  await locator.click({ force: true });
}

function assistantDialog(page) {
  return page.getByRole('dialog', { name: /Skin and Care assistant/i });
}

async function injectOffLikeScan(page) {
  await page.evaluate(async (api) => {
    const sid = sessionStorage.getItem('littlelab_landing_assistant_sid');
    if (!sid) throw new Error('missing littlelab_landing_assistant_sid');
    const productData = {
      barcode: '0096619756803',
      product_name: 'Purified Drinking Water',
      ingredients_text: 'Water, calcium chloride, sodium bicarbonate',
      labels: [],
      allergens: [],
      categories_tags: ['en:beverages'],
      data_source: 'playwright_e2e',
      facts_source: 'open_food_facts'
    };
    const text = [
      `[Barcode Scan] ${productData.product_name} (${productData.barcode})`,
      `Ingredients: ${productData.ingredients_text}`
    ].join('\n');
    const r = await fetch(`${api}/api/public/landing-assistant/thread-event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: sid,
        type: 'barcode_product_context',
        text,
        product_data: productData
      })
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.success) {
      throw new Error(j.error || `thread-event HTTP ${r.status}`);
    }
    window.dispatchEvent(new CustomEvent('littlelab-refresh-result-snapshot'));
  }, MIDDLEWARE_API_BASE);
}

async function run() {
  const health = await fetch(`${MIDDLEWARE_API_BASE}/health`).catch(() => null);
  if (!health || !health.ok) {
    console.error('[playwright-results-ingredient-list-e2e] middleware not reachable at', MIDDLEWARE_API_BASE);
    process.exit(1);
  }

  const browser = await chromium.launch({
    headless: true,
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream']
  });
  const context = await browser.newContext({ permissions: ['camera', 'microphone'] });
  const page = await context.newPage();
  page.setDefaultTimeout(35000);

  const out = { ok: false, error: null, steps: [] };

  try {
    await page.goto(`${BASE_URL}/#assistant/voice`, { waitUntil: 'domcontentloaded' });
    out.steps.push('goto_voice');

    const shell = assistantDialog(page);
    const allowStart = shell.getByRole('button', { name: /allow camera/i });
    await allowStart.waitFor({ state: 'visible', timeout: 20000 });
    await forceClick(allowStart);
    out.steps.push('allow_camera');
    await wait(1500);

    await injectOffLikeScan(page);
    out.steps.push('thread_event_off_water');

    await wait(1200);

    const resultsDialog = page.getByRole('dialog', { name: /Scan results/i });
    await resultsDialog.waitFor({ state: 'visible', timeout: 20000 });
    out.steps.push('results_visible');

    const region = resultsDialog.getByRole('region', { name: /Catalog ingredient list/i });
    await region.waitFor({ state: 'visible', timeout: 10000 });
    await region.getByText(/Open Food Facts/i).waitFor({ state: 'visible', timeout: 5000 });
    await region.getByText(/calcium chloride/i).waitFor({ state: 'visible', timeout: 5000 });

    out.ok = true;
  } catch (e) {
    out.error = e?.message || String(e);
  }

  console.log(JSON.stringify({ ...out, base_url: BASE_URL, api: MIDDLEWARE_API_BASE }, null, 2));
  await browser.close();

  if (!out.ok) process.exit(1);
}

run().catch((e) => {
  console.error('[playwright-results-ingredient-list-e2e] FAIL', e?.message || e);
  process.exit(1);
});
