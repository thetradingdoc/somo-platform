'use strict';

const express = require('express');
const request = require('supertest');

/** Mirrors server.js G4 patient portal retirement redirects. */
function registerPatientPortalRetirement(app) {
  function redirectToProviderSignup(req, res) {
    const params = new URLSearchParams(req.query);
    const qs = params.toString();
    return res.redirect(302, qs ? `/signup?${qs}` : '/signup');
  }
  app.get(['/app', '/join'], (req, res) => redirectToProviderSignup(req, res));
  app.use('/patients', (req, res) => res.redirect(301, '/signup'));
}

describe('patient portal retirement redirects (G4)', () => {
  const app = express();
  registerPatientPortalRetirement(app);

  test('GET /app redirects to /signup', async () => {
    const res = await request(app).get('/app');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/signup');
  });

  test('GET /join preserves query on signup redirect', async () => {
    const res = await request(app).get('/join?ref=demo');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/signup?ref=demo');
  });

  test('GET /patients/* redirects to /signup', async () => {
    const res = await request(app).get('/patients/patient-login.html');
    expect(res.status).toBe(301);
    expect(res.headers.location).toBe('/signup');
  });
});
