const { defineConfig } = require('@playwright/test');

const uiBase = (process.env.PW_UI_BASE_URL || 'https://myskinandcare.com').replace(/\/$/, '');

/** Staging E2E — hits live myskinandcare.com (no local webServer). */
module.exports = defineConfig({
  timeout: 60_000,
  forbidOnly: !!process.env.CI,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: uiBase,
    ignoreHTTPSErrors: true,
    headless: true,
  },
  projects: [
    {
      name: 'staging-smoke',
      testDir: './e2e',
      testMatch: '**/staging-smoke.spec.cjs',
      use: { browserName: 'chromium' },
    },
  ],
});
