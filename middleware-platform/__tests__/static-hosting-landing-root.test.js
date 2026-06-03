'use strict';

const path = require('path');
const fs = require('fs');
const express = require('express');
const request = require('supertest');
const {
  createStaticPathHelpers,
  parseLandingMainBundleSrc,
  isSomoLandingBuildReady,
} = require('../lib/static-hosting-paths');
const { registerEarlySomoLandingStatic } = require('../bootstrap/static-hosting');

const rootDir = path.join(__dirname, '..');

describe('Somo landing root on localhost', () => {
  const { getSomoLandingBuildPath } = createStaticPathHelpers(rootDir);

  beforeAll(() => {
    if (!isSomoLandingBuildReady(getSomoLandingBuildPath)) {
      throw new Error(
        'Missing somo-landing build. Run: cd middleware-platform && npm run build:somo-landing'
      );
    }
  });

  it('index.html references a built /assets/index-*.js bundle', () => {
    const html = fs.readFileSync(getSomoLandingBuildPath('index.html'), 'utf8');
    const src = parseLandingMainBundleSrc(html);
    expect(src).toMatch(/^\/assets\/index-.+\.js$/);
    expect(fs.existsSync(getSomoLandingBuildPath(src.replace(/^\//, '')))).toBe(true);
  });

  it('GET / serves landing HTML with 200 on localhost', async () => {
    const app = express();
    registerEarlySomoLandingStatic(app, { express, rootDir });

    const res = await request(app)
      .get('/')
      .set('Host', 'localhost:4000')
      .set('Connection', 'close');
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/\/assets\/index-/);
    const src = parseLandingMainBundleSrc(res.text);
    expect(src).toBeTruthy();

    const assetRes = await request(app)
      .get(src)
      .set('Host', 'localhost:4000')
      .set('Connection', 'close');
    expect(assetRes.status).toBe(200);
    expect(assetRes.headers['content-type']).toMatch(/javascript/i);

    const cssName = fs
      .readdirSync(getSomoLandingBuildPath('assets'))
      .find((f) => f.endsWith('.css') && f.startsWith('index-'));
    expect(cssName).toBeTruthy();
    const cssRes = await request(app)
      .get(`/assets/${cssName}`)
      .set('Host', 'localhost:4000')
      .set('Connection', 'close');
    expect(cssRes.status).toBe(200);
    expect(cssRes.headers['content-type']).toMatch(/text\/css/i);
  });

  it('GET /fhir/* is not captured by landing SPA on localhost', async () => {
    const app = express();
    registerEarlySomoLandingStatic(app, { express, rootDir });
    app.use((req, res) => res.status(404).json({ error: 'not found' }));

    const res = await request(app)
      .get('/fhir/Patient')
      .set('Host', 'localhost:4000')
      .set('Connection', 'close');
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/application\/json/i);
    expect(res.text).not.toMatch(/<!DOCTYPE html>/i);
  });
});
