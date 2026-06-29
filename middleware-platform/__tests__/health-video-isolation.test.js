'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('../services/video-consult-graph', () => ({
  processEvent: jest.fn().mockResolvedValue({ success: true, stage: 'ended' })
}));

jest.mock('../services/health/agent/orchestrator', () => ({
  processTurn: jest.fn().mockResolvedValue({
    text: 'Thanks for sharing. Can you tell me more?',
    toolEvents: [],
    safety: { emergency: false, flags: [] },
    meta: {}
  }),
  runHealthTurn: jest.fn()
}));

const videoConsultGraph = require('../services/video-consult-graph');
const healthSessionService = require('../services/health-session-service');
const healthTurnService = require('../services/health-turn-service');
const videoConsultRoutes = require('../routes/video-consult');
const healthSessionRoutes = require('../routes/health-session');
const healthTransportRoutes = require('../routes/health-transport');

describe('health room isolation', () => {
  let app;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/api/health-session', healthSessionRoutes);
    app.use('/api/health-session', healthTransportRoutes);
    app.use('/api/video-consult', videoConsultRoutes);
  });

  beforeEach(() => {
    videoConsultGraph.processEvent.mockClear();
  });

  test('isHealthRoom and sessionIdFromRoom', () => {
    expect(healthSessionService.isHealthRoom('health-test')).toBe(true);
    expect(healthSessionService.isHealthRoom('appt-123')).toBe(false);
    expect(healthSessionService.sessionIdFromRoom('health-abc-123')).toBe('abc-123');
  });

  test('end_session on health-* skips videoConsultGraph (legacy video-consult path)', async () => {
    const session = healthSessionService.createSession({ termsAccepted: true });
    const res = await request(app)
      .post('/api/video-consult/agent-events')
      .send({ room: session.room_id, event: 'end_session', payload: {} });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(videoConsultGraph.processEvent).not.toHaveBeenCalled();
  });

  test('end_session on health transport path', async () => {
    const session = healthSessionService.createSession({ termsAccepted: true });
    const res = await request(app)
      .post('/api/health-session/agent-events')
      .send({ room: session.room_id, event: 'end_session', payload: {} });
    expect(res.status).toBe(200);
    expect(res.body.stage).toBe('health_session_ended');
    expect(videoConsultGraph.processEvent).not.toHaveBeenCalled();
  });

  test('end_session on appt-* invokes videoConsultGraph', async () => {
    const res = await request(app)
      .post('/api/video-consult/agent-events')
      .send({ room: 'appt-test-123', event: 'end_session', payload: {} });
    expect(res.status).toBe(200);
    expect(videoConsultGraph.processEvent).toHaveBeenCalled();
  });

  test('health SSE requires token on health-session transport', async () => {
    const session = healthSessionService.createSession({ termsAccepted: true });
    const bad = await request(app).get(`/api/health-session/sse/${session.room_id}`);
    expect(bad.status).toBe(401);
  });

  test('STT ingress disabled by default on agent-events transcript', async () => {
    const session = healthSessionService.createSession({ termsAccepted: true });
    expect(healthTurnService.agentEventTurnIngressEnabled()).toBe(false);
    const res = await request(app)
      .post('/api/health-session/agent-events')
      .send({
        room: session.room_id,
        event: 'transcript',
        payload: { text: 'I have a rash on my arm', speaker: 'patient', is_final: true }
      });
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 50));
    const lines = healthSessionService.listTranscripts(session.id);
    expect(lines.some((l) => l.text.includes('rash'))).toBe(false);
  });

  test('UI turn path persists transcript via health-session API', async () => {
    const session = healthSessionService.createSession({ termsAccepted: true });
    const res = await request(app)
      .post(`/api/health-session/${session.id}/turn`)
      .set('x-health-session-token', session.session_token)
      .send({ text: 'I have a rash on my arm' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const lines = healthSessionService.listTranscripts(session.id);
    expect(lines.some((l) => l.text.includes('rash'))).toBe(true);
  });

  test('provider assistant endpoint skipped for health rooms', async () => {
    const session = healthSessionService.createSession({ termsAccepted: true });
    const res = await request(app).get(`/api/video-consult/assistant/${session.room_id}`);
    expect(res.status).toBe(200);
    expect(res.body.skipped).toBe(true);
    expect(res.body.reason).toBe('health_consumer_room');
  });

  test('health transport rejects appt-* rooms', async () => {
    const res = await request(app)
      .post('/api/health-session/agent-events')
      .send({ room: 'appt-123', event: 'end_session', payload: {} });
    expect(res.status).toBe(400);
  });
});
