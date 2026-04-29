// @ts-check
const { test, expect } = require('@playwright/test');

test.describe('Navigator transition regressions', () => {
  test('flip-card to results handoff keeps payor context', async ({ page }) => {
    await page.goto('/');
    const flipButtons = page.locator('.payor-card-link--flip');
    const count = await flipButtons.count();
    test.skip(count === 0, 'Preview rail is empty in this environment.');

    await flipButtons.first().click();
    const viewDetailsLink = page.locator('.payor-card-back .payor-card-link[href*="?view=results"]').first();
    await expect(viewDetailsLink).toBeVisible();
    await viewDetailsLink.click();
    await expect(page).toHaveURL(/view=results/);
    await expect(page).toHaveURL(/payor=/);
  });

  test('ZIP change triggers re-search URL update', async ({ page }) => {
    await page.goto('/?view=results&zip=10456&needs=dental,vision&sort_by=coverage');
    const zipInput = page.locator('input[aria-label="ZIP code"]');
    await expect(zipInput).toBeVisible();
    await zipInput.fill('10001');
    await page.getByRole('button', { name: /Search results/i }).click();
    await expect(page).toHaveURL(/zip=10001/);
  });

  test('payor context handoff persists in results URL', async ({ page }) => {
    await page.goto('/?view=results&zip=10456&needs=dental&payor=United');
    await expect(page).toHaveURL(/payor=United/);
    await expect(page.getByText('Selected payor')).toBeVisible();
  });
});
