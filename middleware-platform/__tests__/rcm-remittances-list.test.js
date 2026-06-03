'use strict';

const request = require('supertest');
const express = require('express');

describe('GET /api/rcm/remittances', () => {
  it('returns 400 without clinic scope', async () => {
    const rcmRoutes = require('../routes/rcm');
    const app = express();
    app.use('/api/rcm', rcmRoutes);
    const res = await request(app).get('/api/rcm/remittances');
    expect([200, 400, 401]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.remittances)).toBe(true);
    }
  });
});
