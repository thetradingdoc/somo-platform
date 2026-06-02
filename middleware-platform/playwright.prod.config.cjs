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
      name: 'prod-api-smoke',
      testDir: './e2e',
      testMatch: '**/somo-prod-smoke.spec.cjs'
    },
    {
      name: 'prod-smoke-browser',
      testDir: './e2e',
      testMatch: '**/somo-landing.spec.cjs',
      use: { browserName: 'chromium' }
    },
    {
      name: 'prod-mobile',
      testDir: './e2e',
      testMatch: '**/somo-landing.spec.cjs',
      use: {
        browserName: 'chromium',
        viewport: { width: 390, height: 844 }
      }
    }
  ],
  grepInvert: process.env.PW_INCLUDE_BROWSER === '1' ? undefined : /Somo demo landing/
});

