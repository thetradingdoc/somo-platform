#!/usr/bin/env node
'use strict';
/* eslint-disable no-console */

/**
 * Verifies Session Result Snapshot shows Open Beauty Facts product image.
 * Uses barcode 3337875696548 (La Roche-Posay Lipikar — has front image in OBF).
 *
 * Env: UI_BASE_URL (default http://localhost:3000), API default http://localhost:4000
 */

const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { chromium } = require('@playwright/test');

const UI_BASE = String(process.env.UI_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const API_BASE = String(process.env.API_BASE_URL || 'http://localhost:4000').replace(/\/$/, '');
const BARCODE = '3337875696548';

async function main() {
  const outDir = path.resolve(__dirname, '..', 'test-results');
  fs.mkdirSync(outDir, { recursive: true });
  const shotPath = path.join(outDir, `verify-results-image-${Date.now()}.png`);

  const bf = await fetch(`${API_BASE}/api/public/beautyfacts/${BARCODE}`).then((r) => r.json());
  if (!bf?.success || !bf?.product?.image_url) {
    console.error(JSON.stringify({ ok: false, error: 'beautyfacts_missing_image', bf }, null, 2));
    process.exit(1);
  }
  const p = bf.product;
  const sid = randomUUID();
  const contextText = [
    `[Barcode Scan] ${p.product_name} (${p.barcode})`,
    `Product image: ${p.image_url}`,
    `Ingredients: ${String(p.ingredients_text || '').slice(0, 800)}`
  ].join('\n');
  await fetch(`${API_BASE}/api/public/landing-assistant/thread-event`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sid, type: 'barcode_product_context', text: contextText })
  }).then((r) => r.json());

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addInitScript((sessionId) => {
    try {
      sessionStorage.setItem('littlelab_landing_assistant_sid', sessionId);
    } catch (_) {}
  }, sid);

  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  await page.goto(`${UI_BASE}/#assistant/chat`, { waitUntil: 'domcontentloaded' });
  await wait(1500);

  await page.locator('.axc-input').first().fill(
    'Analyze the scanned product in my session and generate skincare report snapshot now.'
  );
  await page.locator('button.axc-send').first().click({ force: true });
  await wait(12000);

  await page.goto(`${UI_BASE}/#assistant/results`, { waitUntil: 'domcontentloaded' });
  await wait(2000);

  const heroSrc = await page.locator('.axr-hero-img').first().getAttribute('src').catch(() => null);
  const imageUnavailable = await page.getByText(/image unavailable/i).first().isVisible().catch(() => false);
  const ready = await page.locator('.axr-hero-img.is-ready').first().isVisible().catch(() => false);

  await page.screenshot({ path: shotPath, fullPage: true });

  const out = {
    ok: ready && !imageUnavailable && !!heroSrc && heroSrc.includes('openbeautyfacts.org'),
    session_id: sid,
    barcode: BARCODE,
    expected_image: p.image_url,
    hero_image_src: heroSrc,
    image_unavailable_visible: imageUnavailable,
    hero_ready: ready,
    screenshot: shotPath
  };
  console.log(JSON.stringify(out, null, 2));
  await browser.close();
  process.exit(out.ok ? 0 : 1);
}

main().catch((e) => {
  console.error('[playwright-results-image-verify]', e?.message || e);
  process.exit(1);
});
