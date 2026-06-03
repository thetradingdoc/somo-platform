'use strict';

const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  timeout: 60_000,
  workers: 1,
  testMatch: '**/debug-patients-roster.spec.cjs',
  use: {
    baseURL: (process.env.PW_API_BASE_URL || 'http://127.0.0.1:4000').replace(/\/$/, ''),
    browserName: 'chromium',
    serviceWorkers: 'block',
    headless: true,
  },
});
