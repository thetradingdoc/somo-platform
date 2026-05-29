// @ts-check
const { test, expect } = require('@playwright/test');

test.describe('Batch 12 full-details and compare regressions', () => {
  test('details drawer opens/closes and compare matrix shows decision signals', async ({ page }) => {
    await page.goto('/?view=results&zip=10456&needs=dental,vision,specialist_visit');

    const detailsButtons = page.getByRole('button', { name: 'View full details →' });
    const detailButtonCount = await detailsButtons.count();
    test.skip(detailButtonCount === 0, 'No plans available for this dataset/ZIP.');

    await detailsButtons.first().click();
    await expect(page.getByLabel('Full plan details')).toBeVisible();
    await expect(page.getByText('Coverage evidence')).toBeVisible();
    await expect(page.getByText('Not available yet')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Share' })).toBeVisible();

    await page.locator('.results-filters-sheet-close').first().click();
    await expect(page.getByLabel('Full plan details')).toHaveCount(0);

    const compareButtons = page.getByRole('button', { name: /Add to compare|Added to compare|✓ In compare/ });
    const compareCount = await compareButtons.count();
    test.skip(compareCount < 2, 'Need at least two compareable plans.');

    await compareButtons.nth(0).click();
    await compareButtons.nth(1).click();

    await expect(page.getByLabel('Side-by-side comparison')).toBeVisible();
    await expect(page.getByText(/Needs covered:/)).toBeVisible();
    await expect(page.locator('.compare-winner-badge').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Get guidance' })).toBeVisible();
  });
});

