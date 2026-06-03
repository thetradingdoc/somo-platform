'use strict';

const { test, expect } = require('@playwright/test');

const API_BASE = (process.env.PW_API_BASE_URL || 'http://127.0.0.1:4000').replace(/\/$/, '');

test.describe('Somo demo landing', () => {
  test('hero and demo form submit (mocked API)', async ({ page }) => {
    let capturedBody = null;
    await page.route('**/api/public/somo-demo/request-call', async (route) => {
      capturedBody = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, demo_request_id: 'test-id', call_id: 'CA_test' })
      });
    });

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/');
    await expect(page.locator('.somo-logo-img')).toBeVisible();
    expect(await page.locator('.somo-logo-img').evaluate((img) => img.naturalWidth)).toBeGreaterThan(0);
    await expect(page.locator('.somo-hero-phone')).toBeVisible();
    expect(await page.locator('.somo-hero-phone').evaluate((img) => img.naturalWidth)).toBeGreaterThan(0);
    await expect(page.getByRole('heading', { name: /never answer business calls again/i })).toBeVisible();
    await expect(page.locator('.somo-nav').getByRole('link', { name: /Try for \$0/i })).toBeVisible();
    await expect(page.locator('.somo-nav').getByRole('link', { name: /Try for \$0/i })).toHaveAttribute('href', /\/login\?/);
    await expect(page.locator('.somo-nav').getByRole('link', { name: /Sign in/i })).toHaveCount(0);
    await expect(page.locator('.somo-trust-section').getByText(/HIPAA-aligned/i)).toBeVisible();
    await expect(page.locator('.somo-scroll-cue')).toBeVisible();
    await expect(page.locator('.somo-scroll-cue__mouse')).toBeVisible();

    const howSection = page.locator('.somo-how');
    await expect(page.getByRole('heading', { name: /^How it works$/i })).toBeVisible();
    await expect(howSection.getByText(/Get your unique number once/i)).toBeVisible();
    await expect(howSection.locator('.somo-how-gecko')).toBeVisible();
    await expect(howSection.getByRole('tab', { name: /Get your number/i })).toBeVisible();
    await expect(howSection.locator('.somo-how-progress__panel.is-active')).toContainText(
      /dedicated Somo line/i
    );
    await howSection.getByRole('tab', { name: /Somo helps them/i }).click();
    const assistPanel = howSection.locator('.somo-how-progress__panel.is-active');
    await expect(assistPanel).toHaveAttribute('data-theme', 'assist');
    await expect(assistPanel).toContainText(/Appointments, questions/i);
    await howSection.getByRole('tab', { name: /You stay in control/i }).click();
    await expect(howSection.locator('.somo-how-progress__panel.is-active')).toContainText(
      /Review every call log/i
    );

    const sectionOrder = ['capabilities', 'how-it-works', 'demo', 'roi', 'pricing', 'languages', 'faq'];
    const sectionIndices = await page.evaluate((ids) => {
      const all = Array.from(document.querySelectorAll('section[id]'));
      return ids.map((id) => all.findIndex((s) => s.id === id));
    }, sectionOrder);
    for (let i = 0; i < sectionIndices.length - 1; i++) {
      expect(sectionIndices[i]).toBeGreaterThanOrEqual(0);
      expect(sectionIndices[i]).toBeLessThan(sectionIndices[i + 1]);
    }

    await expect(page.getByRole('heading', { name: /Replace a \$3,500\/mo receptionist/i })).toBeVisible();

    const roiSection = page.locator('.somo-roi');
    await expect(roiSection.locator('.somo-roi-way')).toHaveCount(2);
    await expect(roiSection.locator('.somo-roi-way--old')).toContainText(/The old way/i);
    await expect(roiSection.locator('.somo-roi-way--old')).toContainText('$3,500+');
    await expect(roiSection.locator('.somo-roi-way--new')).toContainText(/The new way/i);
    await expect(roiSection.locator('.somo-roi-way--new')).toContainText('$199');
    await expect(roiSection.locator('.somo-roi-savings')).toContainText('$50K+');

    await expect(
      page.getByRole('heading', { name: /24\/7 calls, scheduling, & billing assistant/i })
    ).toBeVisible();
    await expect(page.locator('.somo-cap-title-accent')).toHaveText('24/7');

    const capSection = page.locator('.somo-capabilities');
    await expect(capSection.getByRole('tab', { name: /Specialties/i })).toBeVisible();
    await expect(capSection.locator('.somo-cap-option.is-active')).toContainText(/Dental, medical, and specialty/i);
    await capSection.locator('#cap-tab-after_hours').click();
    await expect(capSection.locator('.somo-cap-option.is-active')).toContainText(/Full transcripts by morning/i);
    await expect(capSection.getByRole('tab', { name: /24\/7 coverage/i })).toBeVisible();

    await expect(page.getByText(/Try demo →/i)).toHaveCount(0);
    await expect(page.locator('.somo-hero').getByRole('link', { name: /Try live demo/i })).toBeVisible();
    await expect(page.locator('.somo-pricing').getByRole('link', { name: /Try live demo/i })).toHaveCount(0);
    const pricing = page.locator('.somo-pricing');
    const freeCta = pricing.locator('.somo-pricing-card--free .somo-pricing-cta');
    await expect(freeCta).toHaveClass(/somo-btn-free/);
    await expect(freeCta).not.toHaveClass(/somo-btn-primary/);
    await expect(pricing.getByRole('link', { name: /Try for \$0/i })).toBeVisible();
    await expect(pricing.locator('.somo-pricing-card--free')).toContainText('60 included minutes');
    await expect(pricing.locator('.somo-pricing-card')).toHaveCount(4);
    const popularCard = pricing.locator('.somo-pricing-card-popular');
    await expect(popularCard).toHaveCount(1);
    await expect(popularCard).toContainText(/Most popular/i);
    await expect(popularCard).toContainText('$199');
    await expect(popularCard.locator('.somo-btn-primary')).toHaveCount(1);
    await expect(pricing.locator('.somo-btn-primary')).toHaveCount(1);
    await expect(page.getByRole('link', { name: 'Sign Up', exact: true })).toBeVisible();
    await expect(page.getByText(/AI Front Desk \| 24\/7 Calls & Scheduling/i)).toBeVisible();
    await expect(
      page.getByText(/handles billing for dental and medical practices/i)
    ).toBeVisible();

    await expect(page.getByText(/Somo.*AI front desk/i).first()).toBeVisible();
    await expect(page.locator('#demo select')).toHaveCount(0);
    await expect(page.locator('#demo textarea')).toHaveCount(0);
    await page.getByLabel('Your name').fill('Test User');
    await page.getByLabel('Mobile number').fill('+15555550123');
    await page
      .getByLabel('What do you need help with ?')
      .fill('Need after-hours coverage for a small clinic');
    await expect(page.getByText(/signup link at this same number/i)).toBeVisible();
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: /Get my demo call/i }).click();

    await expect(page.getByText(/Calling you now/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/few quick questions/i)).toBeVisible();
    await expect(page.getByRole('link', { name: /Sign up for Somo/i })).toBeVisible();
    expect(capturedBody).toMatchObject({
      name: 'Test User',
      phone: '+15555550123',
      consent: true,
      questions_asked: 'Need after-hours coverage for a small clinic'
    });
    expect(capturedBody.use_case).toBeUndefined();
  });

  test('capability cards mobile horizontal accordion', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');

    const capSection = page.locator('.somo-capabilities');
    const cards = capSection.locator('.somo-cap-option');
    const firstBox = await cards.nth(0).boundingBox();
    const secondBox = await cards.nth(1).boundingBox();
    expect(firstBox).not.toBeNull();
    expect(secondBox).not.toBeNull();
    expect(Math.abs(firstBox.y - secondBox.y)).toBeLessThan(20);

    const activeCard = capSection.locator('.somo-cap-option.is-active');
    await expect(activeCard.locator('.somo-cap-option__panel')).toBeVisible();
    await expect(activeCard.locator('.somo-cap-option__collapsed')).toBeHidden();

    const inactiveCard = capSection.locator('.somo-cap-option:not(.is-active)').first();
    await expect(inactiveCard.locator('.somo-cap-option__collapsed')).toBeVisible();
    await expect(inactiveCard.locator('.somo-cap-option__panel')).toBeHidden();

    await capSection.locator('#cap-tab-appointments').click();
    const newActive = capSection.locator('.somo-cap-option.is-active');
    await expect(newActive).toContainText(/Patients call anytime/i);
    await expect(capSection.locator('.somo-cap-option:not(.is-active) .somo-cap-option__panel').first()).toBeHidden();
  });

  test('scroll cue hidden on mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await expect(page.locator('.somo-scroll-cue')).toBeHidden();
  });

  test('mobile header and footer layout', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');

    await expect(page.locator('.somo-logo-img')).toBeVisible();
    expect(await page.locator('.somo-logo-img').evaluate((img) => img.naturalWidth)).toBeGreaterThan(0);

    const nav = page.locator('.somo-nav');
    const navBox = await nav.boundingBox();
    expect(navBox).not.toBeNull();
    expect(navBox.height).toBeLessThan(320);

    await expect(nav.locator('.somo-nav-cta')).toBeVisible();
    const ctaBox = await nav.locator('.somo-nav-cta').boundingBox();
    expect(ctaBox).not.toBeNull();
    expect(ctaBox.x + ctaBox.width).toBeLessThanOrEqual(390 + 2);

    const footer = page.locator('.somo-footer');
    await footer.scrollIntoViewIfNeeded();
    await expect(footer.locator('.somo-footer-logo-img')).toBeVisible();
    expect(await footer.locator('.somo-footer-logo-img').evaluate((img) => img.naturalWidth)).toBeGreaterThan(
      0
    );
    await expect(footer.getByRole('link', { name: 'Terms of Service' })).toBeVisible();
    await expect(footer.getByRole('link', { name: 'Sign up' })).toBeVisible();

    const linksOverflow = await page.locator('.somo-footer-links').evaluate((el) => {
      return el.scrollWidth > el.clientWidth + 2;
    });
    expect(linksOverflow).toBe(false);

    await expect(page.locator('.dc-floating-demo')).toHaveCount(0);
  });

  test('pricing cards mobile horizontal slider', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');

    const pricing = page.locator('.somo-pricing');
    const cards = pricing.locator('.somo-pricing-card');
    await expect(cards).toHaveCount(4);
    await expect(cards.first()).toHaveClass(/somo-pricing-card--free/);
    await expect(cards.first()).toContainText('$0');
    await expect(cards.first()).toContainText(/Free trial/i);

    const firstBox = await cards.nth(0).boundingBox();
    const secondBox = await cards.nth(1).boundingBox();
    expect(firstBox).not.toBeNull();
    expect(secondBox).not.toBeNull();
    expect(Math.abs(firstBox.y - secondBox.y)).toBeLessThan(20);
  });

  test('request-call API validates consent', async ({ request }) => {
    try {
      const health = await request.get(`${API_BASE}/api/public/somo-demo/health`, {
        timeout: 5000
      });
      if (!health.ok()) test.skip(true, 'Middleware not running');
    } catch {
      test.skip(true, 'Middleware not reachable');
    }

    const res = await request.post(`${API_BASE}/api/public/somo-demo/request-call`, {
      data: {
        name: 'Test',
        phone: '+15555550123',
        use_case: 'medical_clinic',
        consent: false
      }
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/consent/i);
  });
});
