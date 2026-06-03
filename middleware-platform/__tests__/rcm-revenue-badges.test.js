'use strict';

describe('RCM revenue badges on metrics/health', () => {
  it('returns revenue_badges with sidebar and tab counts', () => {
    const express = require('express');
    const request = require('supertest');
    const rcmRouter = require('../routes/rcm');
    const app = express();
    app.use((req, _res, next) => {
      req.headers['x-clinic-id'] = 'clinic-default';
      next();
    });
    app.use('/api/rcm', rcmRouter);

    return request(app)
      .get('/api/rcm/metrics/health?clinic_id=clinic-default')
      .expect(200)
      .then((res) => {
        expect(res.body.success).toBe(true);
        expect(res.body.metrics.revenue_badges).toBeDefined();
        expect(typeof res.body.metrics.revenue_badges.sidebar).toBe('number');
        expect(res.body.metrics.revenue_badges.tabs).toMatchObject({
          pipeline: expect.any(Number),
          claims: expect.any(Number),
          payments: expect.any(Number),
          work: expect.any(Number),
        });
      });
  });
});

describe('Collection queue enrichment', () => {
  it('includes bill and patient_collection stages with resend_eligible', () => {
    const express = require('express');
    const request = require('supertest');
    const rcmRouter = require('../routes/rcm');
    const app = express();
    app.use((req, _res, next) => {
      req.headers['x-clinic-id'] = 'clinic-default';
      next();
    });
    app.use('/api/rcm', rcmRouter);

    return request(app)
      .get('/api/rcm/collection-queue?clinic_id=clinic-default')
      .expect(200)
      .then((res) => {
        expect(res.body.success).toBe(true);
        expect(Array.isArray(res.body.collection_queue)).toBe(true);
        if (res.body.collection_queue.length) {
          const row = res.body.collection_queue[0];
          expect(row).toHaveProperty('resend_eligible');
          expect(row).toHaveProperty('stage_label');
        }
      });
  });
});
