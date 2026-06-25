'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('../services/video-consult-graph', () => ({
  processEvent: jest.fn().mockResolvedValue({ success: true, stage: 'ended' })
}));

jest.mock('../services/kelly-pa-video-orchestrator', () => ({
  processTurn: jest.fn().mockResolvedValue({
    text: 'Thanks for sharing. Can you tell me more?',
    toolEvents: [],
    safety: { emergency: false, flags: [] },
    meta: {}
  })
}));

const videoConsultGraph = require('../services/video-consult-graph');
const healthSessionService = require('../services/health-session-service');
const videoConsultRoutes = require('../routes/video-consult');
const healthSessionRoutes = require('../routes/health-session');

describe('health room isolation', () => {
  let app;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/api/health-session', healthSessionRoutes);
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

  test('end_session on health-* skips videoConsultGraph', async () => {
    const session = healthSessionService.createSession({ termsAccepted: true });
    const res = await request(app)
      .post('/api/video-consult/agent-events')
      .send({ room: session.room_id, event: 'end_session', payload: {} });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(videoConsultGraph.processEvent).not.toHaveBeenCalled();
  });

  test('end_session on appt-* invokes videoConsultGraph', async () => {
    const res = await request(app)
      .post('/api/video-consult/agent-events')
      .send({ room: 'appt-test-123', event: 'end_session', payload: {} });
    expect(res.status).toBe(200);
    expect(videoConsultGraph.processEvent).toHaveBeenCalled();
  });

  test('patient transcript on health-* triggers Kelly without coding graph', async () => {
    const session = healthSessionService.createSession({ termsAccepted: true });
    const res = await request(app)
      .post('/api/video-consult/agent-events')
      .send({
        room: session.room_id,
        event: 'transcript',
        payload: { text: 'I have a rash on my arm', speaker: 'patient', is_final: true }
      });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(videoConsultGraph.processEvent).not.toHaveBeenCalled();
    await new Promise((r) => setTimeout(r, 50));
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
});
