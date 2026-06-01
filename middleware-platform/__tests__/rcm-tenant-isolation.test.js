'use strict';

const request = require('supertest');
const express = require('express');

describe('RCM / Kelly tenant isolation (G3)', () => {
  it('GET /api/kelly/status returns 401 without customer auth', async () => {
    const kellyRoutes = require('../routes/kelly');
    const app = express();
    app.use('/api/kelly', kellyRoutes);
    const res = await request(app).get('/api/kelly/status');
    expect(res.status).toBe(401);
  });

  it('GET /api/public/rcm/pay/:token does not require provider auth', async () => {
    const rcmPublic = require('../routes/rcm-public');
    const app = express();
    app.use('/api/public/rcm', rcmPublic);
    const res = await request(app).get('/api/public/rcm/pay/nonexistent-token');
    expect([400, 404, 200]).toContain(res.status);
    expect(res.status).not.toBe(401);
  });
});
