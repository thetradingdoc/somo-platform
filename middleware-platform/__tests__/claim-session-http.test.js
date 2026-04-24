'use strict';

const request = require('supertest');
const express = require('express');

describe('POST /api/customer/landing/claim-session (HTTP)', () => {
  test('returns 401 when customer_session cookie is missing', async () => {
    const signupRoutes = require('../routes/signup');
    const app = express();
    app.use('/api', signupRoutes);

    const res = await request(app)
      .post('/api/customer/landing/claim-session')
      .set('Content-Type', 'application/json')
      .send({ landing_session_id: 'sid_abcd1234' });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Authentication required');
  });
});
