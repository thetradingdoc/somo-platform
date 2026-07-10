const { defineConfig } = require('@playwright/test');
const path = require('path');

const { parseEnv } = require('./e2e/helpers/portal-e2e-config.cjs');
const cfg = parseEnv();

module.exports = defineConfig({
  timeout: 240_000,
  forbidOnly: !!process.env.CI,
  workers: 1,
  globalSetup: require.resolve('./e2e/global-setup-portal-e2e.cjs'),
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'test-results/portal-e2e/playwright-report' }]
  ],
  outputDir: 'test-results/portal-e2e/runs',
  use: {
    baseURL: cfg.uiBase,
    ignoreHTTPSErrors: true,
    headless: process.env.PW_HEADED !== '1',
    trace: process.env.PW_TRACE === '1' ? 'on' : 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure'
  },
  projects: [
    {
      name: 'portal-dentist-journey',
      testDir: './e2e',
      testMatch: '**/dentist-journey-parity.spec.cjs',
      use: { browserName: 'chromium' }
    }
  ]
});
