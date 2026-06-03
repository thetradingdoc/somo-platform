'use strict';

const path = require('path');
const fs = require('fs');
const express = require('express');
const request = require('supertest');
const { registerEarlySomoLandingStatic } = require('../bootstrap/static-hosting');

const rootDir = path.join(__dirname, '..');
const heroAsset = path.join(
  rootDir,
  '..',
  'unified-dashboard',
  'somo-landing',
  'build',
  'assets',
  'brand',
  'hero-phone-v2.jpg'
);

describe('registerEarlySomoLandingStatic', () => {
  beforeAll(() => {
    if (!fs.existsSync(heroAsset)) {
      throw new Error(
        'Missing somo-landing build. Run: cd unified-dashboard/somo-landing && npm run build'
      );
    }
  });

  it('serves landing-only /assets/brand/hero-phone-v2.jpg on localhost', async () => {
    const app = express();
    registerEarlySomoLandingStatic(app, { express, rootDir });

    const res = await request(app)
      .head('/assets/brand/hero-phone-v2.jpg')
      .set('Host', 'localhost:4000');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/image\/jpeg/i);
    expect(Number(res.headers['content-length'])).toBeGreaterThan(10_000);
  });

  it('serves somo logo from landing build on localhost', async () => {
    const app = express();
    registerEarlySomoLandingStatic(app, { express, rootDir });

    const res = await request(app)
      .get('/assets/brand/somo-logo.png')
      .set('Host', 'localhost:4000');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/image\/png/i);
  });
});
