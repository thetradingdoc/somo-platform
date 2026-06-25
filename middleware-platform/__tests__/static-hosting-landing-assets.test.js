'use strict';

const path = require('path');
const fs = require('fs');
const express = require('express');
const request = require('supertest');
const { registerEarlySomoLandingStatic } = require('../bootstrap/static-hosting');
const { createStaticPathHelpers } = require('../lib/static-hosting-paths');

const rootDir = path.join(__dirname, '..');

describe('registerEarlySomoLandingStatic', () => {
  const { getUnifiedDashboardPath } = createStaticPathHelpers(rootDir);

  it('serves unified-dashboard /assets on localhost', async () => {
    const apiBase = getUnifiedDashboardPath('assets', 'js', 'api-base.js');
    if (!fs.existsSync(apiBase)) {
      throw new Error('Missing unified-dashboard asset. Check unified-dashboard/assets/js/api-base.js');
    }

    const app = express();
    registerEarlySomoLandingStatic(app, { express, rootDir });

    const res = await request(app)
      .get('/assets/js/api-base.js')
      .set('Host', 'localhost:4000');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/javascript/i);
  });
});
