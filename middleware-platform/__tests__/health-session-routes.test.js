'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('../services/kelly-pa-video-orchestrator', () => ({
  processTurn: jest.fn().mockResolvedValue({
    text: 'Thanks for sharing.',
    toolEvents: [],
    safety: { emergency: false, flags: [] },
    meta: {}
  })
}));

const healthSessionService = require('../services/health-session-service');
const healthSessionRoutes = require('../routes/health-session');

describe('health-session route auth', () => {
  let app;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/api/health-session', healthSessionRoutes);
  });

  test('POST /turn rejects missing session token', async () => {
    const session = healthSessionService.createSession({ termsAccepted: true });
    const turnRes = await request(app)
      .post(`/api/health-session/${session.id}/turn`)
      .send({ text: 'I have a rash' });
    expect(turnRes.status).toBe(401);
    expect(turnRes.body.success).toBe(false);
  });

  test('POST /turn rejects invalid session token', async () => {
    const session = healthSessionService.createSession({ termsAccepted: true });
    const turnRes = await request(app)
      .post(`/api/health-session/${session.id}/turn`)
      .set('x-health-session-token', 'not-a-real-token')
      .send({ text: 'I have a rash' });
    expect(turnRes.status).toBe(401);
  });

  test('GET /report rejects missing session token', async () => {
    const session = healthSessionService.createSession({ termsAccepted: true });
    const reportRes = await request(app).get(`/api/health-session/${session.id}/report`);
    expect(reportRes.status).toBe(401);
  });

  test('POST /turn accepts valid session token', async () => {
    const session = healthSessionService.createSession({ termsAccepted: true });
    const turnRes = await request(app)
      .post(`/api/health-session/${session.id}/turn`)
      .set('x-health-session-token', session.session_token)
      .send({ text: 'I have a rash' });
    expect(turnRes.status).toBe(200);
    expect(turnRes.body.success).toBe(true);
  });
});
