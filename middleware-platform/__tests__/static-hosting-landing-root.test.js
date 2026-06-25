'use strict';

const path = require('path');
const express = require('express');
const request = require('supertest');
const { registerEarlySomoLandingStatic } = require('../bootstrap/static-hosting');

const rootDir = path.join(__dirname, '..');

describe('Marketing root on localhost', () => {
  const prev = process.env.LOCAL_DEV_ROOT;

  afterEach(() => {
    if (prev === undefined) delete process.env.LOCAL_DEV_ROOT;
    else process.env.LOCAL_DEV_ROOT = prev;
  });

  it('GET / redirects to trial activation on localhost when LOCAL_DEV_ROOT unset', async () => {
    delete process.env.LOCAL_DEV_ROOT;
    const app = express();
    registerEarlySomoLandingStatic(app, { express, rootDir });

    const res = await request(app)
      .get('/')
      .set('Host', 'localhost:4000')
      .set('Connection', 'close');

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/business/trial-activation.html');
  });

  it('GET / redirects to health-video when LOCAL_DEV_ROOT=health', async () => {
    process.env.LOCAL_DEV_ROOT = 'health';
    const app = express();
    registerEarlySomoLandingStatic(app, { express, rootDir });

    const res = await request(app)
      .get('/')
      .set('Host', 'localhost:4000')
      .set('Connection', 'close');

    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/health-video/);
  });

  it('GET /fhir/* is not captured by marketing static on localhost', async () => {
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
