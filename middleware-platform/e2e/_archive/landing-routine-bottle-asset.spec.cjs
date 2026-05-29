'use strict';

/**
 * Ensures the routine-band bottle image served with the CRA build matches the file on disk
 * under unified-dashboard/littlelab-landing/build/images/products/effaclar-routine-bottle.png.
 *
 * Guards against stale build/ copies (middleware :4000 and Playwright :5199 both read build/).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { test, expect } = require('@playwright/test');

const ROUTINE_BOTTLE_BUILD = path.join(
  __dirname,
  '..',
  '..',
  'unified-dashboard',
  'littlelab-landing',
  'build',
  'images',
  'products',
  'effaclar-routine-bottle.png'
);

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

test.describe('Landing — routine bottle asset', () => {
  test('build artifact exists', () => {
    expect(fs.existsSync(ROUTINE_BOTTLE_BUILD), `missing ${ROUTINE_BOTTLE_BUILD}`).toBeTruthy();
  });

  test('GET /images/products/effaclar-routine-bottle.png matches build file on disk', async ({ request }) => {
    const expected = fs.readFileSync(ROUTINE_BOTTLE_BUILD);
    const res = await request.get('/images/products/effaclar-routine-bottle.png');
    expect(res.ok(), `HTTP ${res.status()}`).toBeTruthy();
    const got = await res.body();
    expect(sha256(got)).toBe(sha256(expected));
  });

  test('routine-band uses effaclar routine bottle src', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const img = page.locator('section.routine-band img.routine-bottle');
    await expect(img).toBeVisible();
    const src = await img.getAttribute('src');
    expect(src || '').toMatch(/effaclar-routine-bottle\.png/);
  });
});
