const { defineConfig } = require('@playwright/test');

const uiBase = (process.env.PW_UI_BASE_URL || 'https://myskinandcare.com').replace(/\/$/, '');

/** Staging E2E — live myskinandcare.com + api.myskinandcare.com (no local webServer). */
module.exports = defineConfig({
  timeout: 180_000,
  forbidOnly: !!process.env.CI,
  workers: 1,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'test-results/staging-playwright-report' }]
  ],
  outputDir: 'test-results/staging-runs',
  use: {
    baseURL: uiBase,
    ignoreHTTPSErrors: true,
    headless: true,
    trace: process.env.PW_TRACE === '1' ? 'on' : 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  projects: [
    {
      name: 'staging-smoke',
      testDir: './e2e',
      testMatch: '**/staging-smoke.spec.cjs',
      use: { browserName: 'chromium' }
    },
    {
      name: 'staging-signup',
      testDir: './e2e',
      testMatch: '**/staging-signup-journey.spec.cjs',
      use: { browserName: 'chromium' }
    },
    {
      name: 'staging-signup-api',
      testDir: './e2e',
      testMatch: '**/staging-signup-api-trial.spec.cjs',
      use: { browserName: 'chromium' }
    },
    {
      name: 'staging-voice',
      testDir: './e2e',
      testMatch: '**/staging-voice-agent.spec.cjs',
      use: { browserName: 'chromium' }
    }
  ]
});
