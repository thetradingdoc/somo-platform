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
      grep: /mobile header|scroll cue hidden|pricing cards mobile|capability cards mobile/,
      use: {
        browserName: 'chromium',
        viewport: { width: 390, height: 844 },
        serviceWorkers: 'block'
      }
    },
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
  grepInvert: process.env.PW_INCLUDE_BROWSER === '1' ? undefined : /Somo demo landing/
});

