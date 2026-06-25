'use strict';

const path = require('path');
const express = require('express');
const request = require('supertest');
const { registerEarlySomoLandingStatic } = require('../bootstrap/static-hosting');

const rootDir = path.join(__dirname, '..');

describe('Marketing root on localhost', () => {
  it('GET / redirects to trial activation on localhost', async () => {
    const app = express();
    registerEarlySomoLandingStatic(app, { express, rootDir });

    const res = await request(app)
      .get('/')
      .set('Host', 'localhost:4000')
      .set('Connection', 'close');

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/business/trial-activation.html');
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
