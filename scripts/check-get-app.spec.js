import { test } from '@playwright/test';

test('get app click path on localhost', async ({ page }) => {
  await page.goto('http://localhost:4000/', { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');

  const getAppButton = page.getByRole('button', { name: /get the app/i }).first();
  await getAppButton.click();
  await page.waitForTimeout(1200);

  const currentUrl = page.url();
  const waitlistHeading = page.getByRole('heading', { name: /join the waitlist/i }).first();
  const waitlistModalVisible = await waitlistHeading.isVisible().catch(() => false);

  // eslint-disable-next-line no-console
  console.log(`RESULT url=${currentUrl} waitlistModalVisible=${waitlistModalVisible}`);
});
