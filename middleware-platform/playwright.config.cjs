const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  forbidOnly: !!process.env.CI,
  workers: 1,
  use: {
    ignoreHTTPSErrors: true,
    headless: true,
    // Avoid Playwright "channel" dependency (Chrome for Testing) which is often
    // missing in CI/sandbox environments. Use Playwright-managed browsers instead.
    serviceWorkers: 'block',
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
});
