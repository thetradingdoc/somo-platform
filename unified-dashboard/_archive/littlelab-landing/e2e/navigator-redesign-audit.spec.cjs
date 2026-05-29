// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * Automated checks against `patient_navigator_landing_redesign (3).html`:
 * top nav, hero copy shape, trust row (two live figures from /meta), and banned marketing line on cards.
 */
test.describe('Medicare navigator landing vs HTML redesign reference', () => {
  test('header-to-trust: structure, mega nav, no banned card line', async ({ page }) => {
    await page.goto('/');

    await expect(page.locator('main.navigator-shell')).toBeVisible();

    const primaryNav = page.getByRole('navigation', { name: 'Primary' });
    await expect(primaryNav).toBeVisible();
    await expect(primaryNav.getByText('Patient Navigator')).toBeVisible();
    await expect(primaryNav.getByText('#1 Medicare Advisor')).toBeVisible();
    await expect(primaryNav.getByRole('link', { name: 'Find plans' })).toHaveAttribute('href', '/?view=results');
    await expect(primaryNav.getByRole('link', { name: 'How it works' })).toHaveAttribute('href', '/?doc=how-it-works');
    await expect(primaryNav.getByRole('link', { name: 'Get app' })).toBeVisible();

    await expect(page.getByRole('heading', { level: 1, name: /Find the right Medicare/ })).toBeVisible();
    await expect(page.getByText('Quick select:', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Physio' })).toBeVisible();
    await expect(page.getByRole('button', { name: '$0 premium' })).toBeVisible();

    await expect(page.getByText('Trusted by members for consistent care')).toHaveCount(0);

    await expect(page.getByText(/^Updated /)).toBeVisible();
    await expect(page.getByText(/\d+ plans/)).toHaveCount(0);
    await expect(page.getByText('Data live', { exact: false })).toHaveCount(0);
    await expect(page.getByText('Benefit rows from CMS official data')).toBeVisible();
    await expect(page.getByText('MA plans compared across all states')).toBeVisible();

    /* Plan preview rail (carousel) — may be empty if API/ZIP returns no plans; section shell should exist. */
    await expect(page.locator('section.payor-gallery')).toBeVisible();
  });
});
