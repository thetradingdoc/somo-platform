import { chromium } from 'playwright';

const baseUrl = process.env.CHECK_URL || 'http://localhost:4000/';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });

try {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForLoadState('networkidle', { timeout: 30000 });

  const getAppButton = page.getByRole('button', { name: /get the app/i }).first();
  await getAppButton.click({ timeout: 15000 });

  await page.waitForTimeout(1200);

  const url = page.url();
  const waitlistModalVisible = await page.getByRole('heading', { name: /join the waitlist/i }).first().isVisible().catch(() => false);
  console.log(JSON.stringify({ url, waitlistModalVisible }));
} finally {
  await browser.close();
}
