'use strict';

/**
 * Skin & Care landing — Playwright E2E
 *
 * A) Static bundle (served by playwright.config webServer on :5199)
 * B) Middleware HTTP pipeline (optional): set PW_API_BASE_URL if middleware is running
 *    (default http://127.0.0.1:4000). Uses clinic_id from DEFAULT_CLINIC_ID / SMOKE_CLINIC_ID or clinic-default.
 */

const { test, expect } = require('@playwright/test');
const { randomUUID } = require('crypto');

const HERO_LINE1 = 'Track your skin concerns';
const HERO_LINE2 = 'with just a picture';
const HERO_FULL = `${HERO_LINE1} ${HERO_LINE2}`;
const LEGACY_HEADLINE = 'Skincare Ingredients that Work';

const API_BASE = (process.env.PW_API_BASE_URL || process.env.PW_BASE_URL || 'http://127.0.0.1:4000').replace(
  /\/$/,
  ''
);
const CLINIC_ID = String(
  process.env.DEFAULT_CLINIC_ID || process.env.SMOKE_CLINIC_ID || 'clinic-default'
).trim();

async function isMiddlewareReachable(request) {
  try {
    const r = await request.get(`${API_BASE}/health`, { timeout: 5000 });
    return r.ok();
  } catch {
    return false;
  }
}

// ─── Static marketing page (LittleLab CRA build) ─────────────────────────────

test.describe('Landing — document & accessibility', () => {
  test('loads root with OK status', async ({ page }) => {
    const res = await page.goto('/', { waitUntil: 'domcontentloaded' });
    expect(res?.ok() || res?.status() === 304).toBeTruthy();
  });

  test('document title references Skin & Care', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveTitle(/skin/i);
  });

  test('viewport meta is present for mobile layout', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const viewport = page.locator('meta[name="viewport"]');
    await expect(viewport).toHaveCount(1);
  });

  test('skip link targets main content', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const skip = page.locator('a.skip-link');
    await expect(skip).toBeVisible();
    await expect(skip).toHaveAttribute('href', '#main-content');
  });
});

test.describe('Landing — header & navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
  });

  test('brand shows Skin & Care with logo', async ({ page }) => {
    const brand = page.locator('a.brand-mark');
    await expect(brand).toBeVisible();
    await expect(brand).toContainText(/skin\s*&\s*care/i);
    await expect(brand.locator('img.brand-mark-logo')).toBeVisible();
  });

  test('desktop nav exposes Products and Skin Diagnosis', async ({ page }) => {
    const nav = page.getByRole('navigation', { name: /main navigation/i });
    await expect(nav.getByRole('link', { name: 'Products' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Skin Diagnosis' })).toBeVisible();
  });

  test('header Start Analysis navigates to patient flow', async ({ page }) => {
    const start = page.locator('.nav-actions a.btn-primary.nav-start-btn');
    await expect(start).toBeVisible();
    await expect(start).toContainText(/start analysis/i);
    const href = await start.getAttribute('href');
    expect(href).toMatch(/patient-login/i);
  });
});

test.describe('Landing — hero & value proposition', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
  });

  test('social kicker is visible', async ({ page }) => {
    const kicker = page.locator('.kicker--social');
    await expect(kicker).toBeVisible();
    await expect(kicker).toContainText(/4\.9|rating|doctors/i);
  });

  test('hero h1 has correct two-line structure and copy', async ({ page }) => {
    const h1 = page.getByRole('heading', { level: 1 });
    await expect(h1).toBeVisible();
    await expect(h1).toContainText(HERO_FULL);
    await expect(h1).not.toContainText(LEGACY_HEADLINE);
    await expect(h1).not.toContainText(/calories/i);

    await expect(page.locator('.hero-title-line1')).toHaveText(HERO_LINE1);
    await expect(page.locator('.hero-title-line2')).toHaveText(HERO_LINE2);
  });

  test('subtext mentions photo and barcode guidance', async ({ page }) => {
    const sub = page.locator('#main-content .subtext');
    await expect(sub).toBeVisible();
    await expect(sub).toContainText(/snap|photo|barcode/i);
  });

  test('hero CTAs include Start Analysis and a phone link', async ({ page }) => {
    const ctas = page.locator('.hero-ctas');
    await expect(ctas.getByRole('link', { name: /start analysis/i })).toBeVisible();
    const tel = ctas.locator('a[href^="tel:"]');
    await expect(tel).toHaveCount(1);
  });

  test('hero scan preview image is present', async ({ page }) => {
    const stage = page.locator('#demo.scan-stage');
    await expect(stage).toBeVisible();
    const img = stage.locator('img.hero-image-full');
    await expect(img).toBeVisible();
    const alt = await img.getAttribute('alt');
    expect(alt && alt.length > 5).toBeTruthy();
  });
});

test.describe('Landing — phone viewport layout', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('mobile menu toggles panel with nav links', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const toggle = page.getByRole('button', { name: /toggle navigation menu|menu/i });
    await expect(toggle).toBeVisible();
    await toggle.click();
    const panel = page.getByRole('dialog', { name: /mobile navigation menu/i });
    await expect(panel).toBeVisible();
    await expect(panel.getByRole('link', { name: 'Products' })).toBeVisible();
    await toggle.click();
    await expect(panel).toBeHidden();
  });

  test('hero headline stacks as two lines (line2 below line1)', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    const line1 = page.locator('.hero-title-line1');
    const line2 = page.locator('.hero-title-line2');
    await expect(line1).toBeVisible();
    await expect(line2).toBeVisible();
    const b1 = await line1.boundingBox();
    const b2 = await line2.boundingBox();
    expect(b1 && b2).toBeTruthy();
    expect(b2.y).toBeGreaterThan(b1.y);
    await expect(line1).toHaveText(HERO_LINE1);
  });
});

test.describe('Landing — below-the-fold sections', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
  });

  test('products section is reachable and titled', async ({ page }) => {
    await page.locator('#products').scrollIntoViewIfNeeded();
    await expect(page.locator('#products')).toBeVisible();
    await expect(page.locator('section#products.solutions h2')).toContainText(/skincare|prescriptions/i);
  });
});

// ─── Middleware: public landing assistant + results (optional) ──────────────

test.describe('Pipeline — public landing assistant API', () => {
  test('POST /api/public/landing-assistant/turn rejects empty body', async ({ request }) => {
    test.skip(!(await isMiddlewareReachable(request)), `Middleware not up at ${API_BASE} (start server or set PW_API_BASE_URL)`);
    const res = await request.post(`${API_BASE}/api/public/landing-assistant/turn`, {
      data: { message: '   ', session_id: randomUUID(), clinic_id: CLINIC_ID },
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status()).toBe(400);
    const j = await res.json().catch(() => ({}));
    expect(j.success === false || j.error).toBeTruthy();
  });

  test('POST turn: first message returns assistant reply and session_id', async ({ request }) => {
    test.skip(!(await isMiddlewareReachable(request)), `Middleware not up at ${API_BASE}`);
    const sessionId = randomUUID();
    const res = await request.post(`${API_BASE}/api/public/landing-assistant/turn`, {
      data: {
        message: 'Hi — I have dry sensitive skin on my cheeks.',
        session_id: sessionId,
        clinic_id: CLINIC_ID,
        kelly_flow: 'skincare',
      },
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.ok(), await res.text()).toBeTruthy();
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.session_id).toBe(sessionId);
    expect(String(json.reply || '').trim().length).toBeGreaterThan(10);
    expect(Array.isArray(json.toolsUsed)).toBe(true);
  });

  test('POST turn: second message keeps same session', async ({ request }) => {
    test.skip(!(await isMiddlewareReachable(request)), `Middleware not up at ${API_BASE}`);
    const sessionId = randomUUID();
    const body = (msg) => ({
      message: msg,
      session_id: sessionId,
      clinic_id: CLINIC_ID,
      kelly_flow: 'skincare',
    });
    const r1 = await request.post(`${API_BASE}/api/public/landing-assistant/turn`, {
      data: body('My skin stings after retinol.'),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(r1.ok()).toBeTruthy();
    const r2 = await request.post(`${API_BASE}/api/public/landing-assistant/turn`, {
      data: body('It gets worse in winter.'),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(r2.ok()).toBeTruthy();
    const j2 = await r2.json();
    expect(j2.session_id).toBe(sessionId);
    expect(String(j2.reply || '').length).toBeGreaterThan(5);
  });

  test('GET results bootstraps snapshot for anonymous session', async ({ request }) => {
    test.skip(!(await isMiddlewareReachable(request)), `Middleware not up at ${API_BASE}`);
    const sessionId = randomUUID();
    const res = await request.get(`${API_BASE}/api/public/landing-assistant/results/${sessionId}`);
    expect(res.ok()).toBeTruthy();
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.session_id).toBe(sessionId);
    expect(json.session_result_snapshot).toBeTruthy();
    expect(json.session_result_snapshot.schema_version).toBeTruthy();
    expect(json.snapshot_id).toBeTruthy();
  });
});

test.describe('Pipeline — BeautyFacts public proxy (optional)', () => {
  test('GET barcode returns JSON envelope (may be upstream error without OBF)', async ({ request }) => {
    test.skip(!(await isMiddlewareReachable(request)), `Middleware not up at ${API_BASE}`);
    const res = await request.get(`${API_BASE}/api/public/beautyfacts/3017620422005`);
    expect([200, 404, 502, 503]).toContain(res.status());
    const json = await res.json().catch(() => null);
    if (json && typeof json === 'object') {
      expect('success' in json || 'error' in json || 'barcode' in json).toBeTruthy();
    }
  });
});
