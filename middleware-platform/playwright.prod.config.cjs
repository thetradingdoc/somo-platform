const { defineConfig } = require('@playwright/test');
const { UI_BASE: uiBase } = require('./e2e/helpers/callsomo-urls.cjs');

module.exports = defineConfig({
  timeout: 180_000,
  forbidOnly: !!process.env.CI,
  workers: 1,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'test-results/prod-playwright-report' }]
  ],
  outputDir: 'test-results/prod-runs',
  use: {
    baseURL: uiBase,
    ignoreHTTPSErrors: true,
    headless: process.env.HEADED !== '1',
    trace: process.env.PW_TRACE === '1' ? 'on' : 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  projects: [
    {
      name: 'provider-journey-prod',
      testDir: './e2e/provider',
      testMatch: '**/provider-portal-journey-prod.spec.cjs',
      timeout: 120_000,
      use: {
        browserName: 'chromium',
        baseURL: (process.env.PW_PROD_UI_BASE_URL || 'https://callsomo.com').replace(/\/$/, ''),
        serviceWorkers: 'block'
      }
    }
  ],
});

