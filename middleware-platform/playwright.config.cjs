const path = require('path');
const { defineConfig } = require('@playwright/test');

const landingBuild = path.join(__dirname, '..', 'unified-dashboard', 'somo-landing', 'build');
const serveScript = path.join(__dirname, 'scripts', 'serve-cra-build.cjs');

const headed = process.env.HEADED === '1';

/** Static server port (Playwright webServer + baseURL). Override if 5199 is busy: `PW_LANDING_PORT=5200 npx playwright test …` */
const landingPort = String(process.env.PW_LANDING_PORT || '5199').trim() || '5199';
const landingOrigin = `http://127.0.0.1:${landingPort}`;

/**
 * Somo landing E2E: serves `somo-landing/build` (default :5199).
 * - Landing UI: `npm run test:e2e-landing` (builds first)
 * - Headed: `HEADED=1 npx playwright test --project landing`
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
      testMatch: '**/somo-landing.spec.cjs',
      use: { browserName: 'chromium' },
    },
    {
      name: 'signup-wizard',
      testDir: './e2e',
      testMatch: '**/somo-signup-wizard.spec.cjs',
      use: {
        browserName: 'chromium',
        baseURL: (process.env.PW_API_BASE_URL || 'http://127.0.0.1:4000').replace(/\/$/, ''),
      },
    },
    {
      name: 'provider-trial',
      testDir: './e2e',
      testMatch: '**/provider-trial-signup.spec.cjs',
      timeout: 120_000,
      use: {
        browserName: 'chromium',
        baseURL: (process.env.PW_API_BASE_URL || 'http://127.0.0.1:4000').replace(/\/$/, ''),
      },
      env: {
        DB_PATH: path.join(__dirname, 'middleware-dev.db'),
      },
    },
    {
      name: 'kelly-golden',
      testDir: './e2e',
      testMatch: '**/kelly-rcm-golden-path.spec.cjs',
      timeout: 600_000,
      use: {
        browserName: 'chromium',
        baseURL: (process.env.PW_API_BASE_URL || 'http://127.0.0.1:4000').replace(/\/$/, ''),
      },
      env: {
        DB_PATH: path.join(__dirname, 'middleware-dev.db'),
      },
    },
    {
      name: 'kelly-f2',
      testDir: './e2e',
      testMatch: '**/f2-tom-harris-journey.spec.cjs',
      timeout: 1_200_000,
      use: {
        browserName: 'chromium',
        baseURL: (process.env.PW_API_BASE_URL || 'http://127.0.0.1:4000').replace(/\/$/, ''),
      },
      env: {
        DB_PATH: path.join(__dirname, 'middleware-dev.db'),
        KELLY_RAILS_V2: '1',
        KELLY_RAILS_ROLLOUT_PCT: '1',
        LANGGRAPH_KELLY_ROLLOUT_PCT: '0',
        KELLY_F2_TOM_HARRIS: '1',
        KELLY_RAILS_FAST_RAG: '1',
        RCM_E2E_RECORD_EMAIL: '1',
        SKIP_STARTUP_MIGRATIONS: '1',
      },
    },
    {
      name: 'provider-portal',
      testDir: './e2e',
      testMatch: '**/provider-today-portal.spec.cjs',
      timeout: 60_000,
      use: {
        browserName: 'chromium',
        baseURL: (process.env.PW_API_BASE_URL || 'http://127.0.0.1:4000').replace(/\/$/, ''),
      },
    },
    {
      name: 'provider-rcm',
      testDir: './e2e',
      testMatch: ['**/*rcm*.spec.cjs', '**/patient-wallet-bills.spec.cjs'],
      testIgnore: '**/kelly-rcm-golden-path.spec.cjs',
      timeout: 120_000,
      use: {
        browserName: 'chromium',
        baseURL: (process.env.PW_API_BASE_URL || 'http://127.0.0.1:4000').replace(/\/$/, ''),
      },
    },
    {
      name: 'voice-agent',
      testDir: './e2e',
      testMatch: '**/voice-agent-page.spec.cjs',
      timeout: 60_000,
      use: {
        browserName: 'chromium',
        baseURL: (process.env.PW_API_BASE_URL || 'http://127.0.0.1:4000').replace(/\/$/, ''),
      },
    },
    {
      name: 'somo-login',
      testDir: './e2e',
      testMatch: '**/somo-login.spec.cjs',
      use: {
        browserName: 'chromium',
        baseURL: (process.env.PW_API_BASE_URL || 'http://127.0.0.1:4000').replace(/\/$/, ''),
      },
    },
  ],
  webServer: {
    command: `node "${serveScript}" "${landingBuild}" ${landingPort}`,
    url: landingOrigin,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
