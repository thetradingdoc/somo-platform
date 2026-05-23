'use strict';

const express = require('express');
const request = require('supertest');
const db = require('../database');
const { ensurePatientPortalEventsTable } = require('../lib/patient-portal-events');
const { registerPatientFunnelBridgeRoutes } = require('../routes/patient-funnel-bridge');

describe('POST /api/patient/funnel/event', () => {
  let app;
  const sessionId = 'ps_funnel_event_test';

  beforeAll(() => {
    ensurePatientPortalEventsTable();
    app = express();
    const requirePatientSession = (req, res, next) => {
      const sid = String(req.headers['x-session-id'] || '').trim();
      if (!sid) return res.status(401).json({ success: false, error: 'session_required' });
      req.patientSessionId = sid;
      req.patientSession = { patient_id: 'pat_test' };
      return next();
    };
    const recordPatientPortalEvent = (req, eventName, metadata) => {
      const { recordPatientPortalEvent: record } = require('../middleware/patient-session');
      record(req, eventName, metadata);
    };
    registerPatientFunnelBridgeRoutes(app, {
      apiLimiter: (req, res, next) => next(),
      requirePatientSession,
      recordPatientPortalEvent,
    });
  });

  test('records auth_handoff_continue_web', async () => {
    const res = await request(app)
      .post('/api/patient/funnel/event')
      .set('x-session-id', sessionId)
      .send({
        event: 'auth_handoff_continue_web',
        route: 'program',
        concern_id: 'acne',
        user_goal: 'track_program',
      });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.event).toBe('auth_handoff_continue_web');

    const row = db.db
      .prepare(
        `SELECT event_name, metadata_json FROM patient_portal_events
         WHERE session_id = ? AND event_name = ? ORDER BY created_at DESC LIMIT 1`,
      )
      .get(sessionId, 'auth_handoff_continue_web');
    expect(row).toBeTruthy();
    expect(row.event_name).toBe('auth_handoff_continue_web');
    const meta = JSON.parse(row.metadata_json);
    expect(meta.concern_id).toBe('acne');
    expect(meta.route).toBe('program');
  });

  test('rejects unknown event names', async () => {
    const res = await request(app)
      .post('/api/patient/funnel/event')
      .set('x-session-id', sessionId)
      .send({ event: 'not_allowed' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_event');
  });
});
