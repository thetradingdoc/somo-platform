const path = require('path');
const { defineConfig } = require('@playwright/test');

const landingBuild = path.join(__dirname, '..', 'unified-dashboard', 'littlelab-landing', 'build');
const serveScript = path.join(__dirname, 'scripts', 'serve-cra-build.cjs');

const headed = process.env.HEADED === '1';

/** Static server port (Playwright webServer + baseURL). Override if 5199 is busy: `PW_LANDING_PORT=5200 npx playwright test …` */
const landingPort = String(process.env.PW_LANDING_PORT || '5199').trim() || '5199';
const landingOrigin = `http://127.0.0.1:${landingPort}`;

/**
 * Landing E2E: serves the CRA `littlelab-landing/build` tree (default :5199).
 * - Landing UI: `npm run test:e2e-landing` (builds first)
 * - Acne eval journey: `npx playwright test --project acne-journey`
 * - Headed (all projects): `HEADED=1 npx playwright test`
 *
 * API tests use PW_API_BASE_URL (default :4000).
 */
module.exports = defineConfig({
  timeout: 90_000,
  expect: { timeout: 15_000 },
  forbidOnly: !!process.env.CI,
  workers: 1,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
  ],
  use: {
    baseURL: landingOrigin,
    ignoreHTTPSErrors: true,
    headless: !headed,
    serviceWorkers: 'block',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: process.env.CI ? 'retain-on-failure' : 'off',
  },
  projects: [
    {
      name: 'landing',
      testDir: './e2e',
      testMatch: '**/landing*.spec.cjs',
      use: { browserName: 'chromium' },
    },
    {
      name: 'acne-journey',
      testDir: './tests/e2e',
      testMatch: '**/acne-patient-journey.spec.cjs',
      timeout: 300_000,
      use: { browserName: 'chromium' },
    },
  ],
  webServer: {
    command: `node "${serveScript}" "${landingBuild}" ${landingPort}`,
    url: landingOrigin,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
