const path = require('path');
const { defineConfig } = require('@playwright/test');

const headed = process.env.HEADED === '1';
const tenantAuditOnly = process.argv.some((a) => a.includes('tenant-audit') || a.includes('tenant-front-desk-audit'));

const apiBase = (process.env.PW_API_BASE_URL || 'http://127.0.0.1:4000').replace(/\/$/, '');

/**
 * Provider / API E2E against middleware (default :4000).
 * Headed: `HEADED=1 npx playwright test --project provider-portal`
 */
module.exports = defineConfig({
  timeout: 90_000,
  expect: { timeout: 15_000 },
  forbidOnly: !!process.env.CI,
  workers: 1,
  globalSetup: tenantAuditOnly
    ? require.resolve('./e2e/global-setup-tenant-audit.cjs')
    : undefined,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
  ],
  use: {
    baseURL: apiBase,
    ignoreHTTPSErrors: true,
    headless: !headed,
    serviceWorkers: 'block',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: process.env.CI ? 'retain-on-failure' : 'off',
  },
  projects: [
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
      name: 'health-video',
      testDir: './e2e',
      testMatch: '**/health-video-demo.spec.cjs',
      timeout: 120_000,
      use: {
        browserName: 'chromium',
        baseURL: (process.env.PW_API_BASE_URL || 'http://127.0.0.1:4000').replace(/\/$/, ''),
        viewport: { width: 1280, height: 720 },
      },
    },
    {
      name: 'health-video-mobile',
      testDir: './e2e',
      testMatch: '**/health-video-demo.spec.cjs',
      timeout: 120_000,
      use: {
        browserName: 'chromium',
        baseURL: (process.env.PW_API_BASE_URL || 'http://127.0.0.1:4000').replace(/\/$/, ''),
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: 'provider-journey',
      testDir: './e2e/provider',
      testMatch: ['**/*.spec.cjs'],
      timeout: 120_000,
      use: {
        browserName: 'chromium',
        baseURL: (process.env.PW_API_BASE_URL || 'http://127.0.0.1:4000').replace(/\/$/, ''),
        serviceWorkers: 'block',
      },
      env: {
        DB_PATH: path.join(__dirname, 'middleware-dev.db'),
      },
    },
    {
      name: 'provider-portal',
      testDir: './e2e',
      testMatch: [
        '**/provider-portal-shell.spec.cjs',
      ],
      timeout: 120_000,
      use: {
        browserName: 'chromium',
        baseURL: (process.env.PW_API_BASE_URL || 'http://127.0.0.1:4000').replace(/\/$/, ''),
      },
    },
    {
      name: 'provider-rcm',
      testDir: './e2e',
      testMatch: [
        '**/*rcm*.spec.cjs',
        '**/patient-wallet-bills.spec.cjs',
        '**/provider-rcm-payments-ui.spec.cjs',
        '**/provider-rcm-journey-ui.spec.cjs',
      ],
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
      env: {
        DB_PATH: path.join(__dirname, 'middleware-dev.db'),
      },
    },
    {
      name: 'tenant-audit',
      testDir: './e2e',
      testMatch: '**/tenant-front-desk-audit.spec.cjs',
      timeout: 180_000,
      use: {
        browserName: 'chromium',
        baseURL: (process.env.PW_API_BASE_URL || 'http://127.0.0.1:4001').replace(/\/$/, ''),
        serviceWorkers: 'block',
      },
      env: {
        DB_PATH: path.join(__dirname, 'middleware-audit.db'),
        PW_API_BASE_URL: (process.env.PW_API_BASE_URL || 'http://127.0.0.1:4001').replace(/\/$/, ''),
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
});
