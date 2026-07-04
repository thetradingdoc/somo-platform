'use strict';

const path = require('path');
const express = require('express');
const request = require('supertest');
const {
  registerEarlySomoLandingStatic,
  getSomoLandingBuildDir,
} = require('../bootstrap/static-hosting');

const rootDir = path.join(__dirname, '..');
const landingBuild = getSomoLandingBuildDir(rootDir);

describe('Marketing root on localhost', () => {
  it('GET / serves marketing landing or redirects to signup (never trial-activation)', async () => {
    const app = express();
    registerEarlySomoLandingStatic(app, { express, rootDir });

    const res = await request(app)
      .get('/')
      .set('Host', 'localhost:4000')
      .set('Connection', 'close');

    if (landingBuild) {
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/html/i);
      expect(res.text).not.toMatch(/trial-activation/i);
    } else {
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/signup');
    }
    expect(res.headers.location).not.toBe('/business/trial-activation.html');
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
