#!/usr/bin/env node
/* eslint-disable no-console */
const { chromium } = require('playwright');

const BASE_URL = process.env.LANDING_BASE_URL || 'http://localhost:4000';
const ZIPS = ['10456', '11432', '10001', '77001', '75201', '78701', '33101', '94105'];

async function run() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1365, height: 900 } });
  const results = [];

  for (const zip of ZIPS) {
    const row = { zip };
    try {
      await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(400);
      await page.locator('input.navigator-input').first().fill(`City ST ${zip}`);
      await page.locator('button.needs-picker-btn').first().click();
      await page.locator('.needs-picker-item', { hasText: 'Vision' }).first().click();
      await page.locator('.needs-picker-item', { hasText: 'Cancer care' }).first().click();
      await page.locator('button.navigator-search-btn').first().click();
      await page.waitForTimeout(1000);

      const url = new URL(page.url());
      row.url_zip = url.searchParams.get('zip');
      row.zip_preserved = row.url_zip === zip;
      row.unmapped_warning = await page.getByText(new RegExp(`ZIP\\s+${zip}\\s+is not mapped yet`, 'i')).isVisible().catch(() => false);
    } catch (error) {
      row.error = String(error?.message || error);
    }
    results.push(row);
  }

  const summary = {
    total: results.length,
    preserved_count: results.filter((r) => r.zip_preserved).length,
    mismatched_count: results.filter((r) => r.zip_preserved === false).length,
    errors: results.filter((r) => r.error).length
  };
  console.log(JSON.stringify({ summary, results }, null, 2));
  await browser.close();
  process.exit(summary.mismatched_count || summary.errors ? 1 : 0);
}

run().catch((error) => {
  console.error(JSON.stringify({ success: false, error: String(error?.message || error) }, null, 2));
  process.exit(1);
});
