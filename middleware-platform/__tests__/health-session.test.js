'use strict';

const healthSessionService = require('../services/health-session-service');
const modelRouter = require('../services/health-video-model-router');

describe('health-session-service', () => {
  test('isHealthRoom detects health-* prefix', () => {
    expect(healthSessionService.isHealthRoom('health-abc')).toBe(true);
    expect(healthSessionService.isHealthRoom('appt-123')).toBe(false);
  });

  test('sessionIdFromRoom strips prefix', () => {
    expect(healthSessionService.sessionIdFromRoom('health-uuid-here')).toBe('uuid-here');
    expect(healthSessionService.sessionIdFromRoom('appt-1')).toBeNull();
  });

  test('createSession returns tokens', () => {
    const session = healthSessionService.createSession({
      termsAccepted: true,
      locale: 'en',
      replyLanguage: 'en'
    });
    expect(session.room_id).toMatch(/^health-/);
    expect(session.session_token).toBeTruthy();
    expect(session.sse_token).toBeTruthy();
    expect(session.terms_version).toBeTruthy();
  });

  test('verifySessionToken validates token', () => {
    const session = healthSessionService.createSession({ termsAccepted: true });
    expect(healthSessionService.verifySessionToken(session.id, session.session_token)).toBe(true);
    expect(healthSessionService.verifySessionToken(session.id, 'bad')).toBe(false);
  });

  test('verifySseToken validates room sse token', () => {
    const session = healthSessionService.createSession({ termsAccepted: true });
    expect(healthSessionService.verifySseToken(session.room_id, session.sse_token)).toBe(true);
    expect(healthSessionService.verifySseToken(session.room_id, 'bad')).toBe(false);
    expect(healthSessionService.verifySseToken('appt-1', session.sse_token)).toBe(false);
  });

  test('persistTranscript stores rows', () => {
    const session = healthSessionService.createSession({ termsAccepted: true });
    healthSessionService.persistTranscript(session.id, session.room_id, {
      speaker: 'patient',
      text: 'Mild headache',
      text_original: 'Mild headache',
      text_translated: null,
      source: 'stt'
    });
    const lines = healthSessionService.listTranscripts(session.id);
    expect(lines).toHaveLength(1);
    expect(lines[0].text).toBe('Mild headache');
    expect(lines[0].speaker).toBe('patient');
  });

  test('saveReport and endSession attach report', () => {
    const session = healthSessionService.createSession({ termsAccepted: true });
    const report = { summary: 'Test summary', chief_complaint: 'headache' };
    healthSessionService.saveReport(session.id, report);
    const ended = healthSessionService.endSession(session.id, report);
    expect(ended.session_status).toBe('ended');
    expect(ended.report.summary).toBe('Test summary');
  });
});

describe('health-video-model-router', () => {
  test('selectOrchestratorModel escalates on later rounds', () => {
    expect(modelRouter.selectOrchestratorModel({ toolRound: 0 })).toBe(modelRouter.DEFAULT_MODEL);
    expect(modelRouter.selectOrchestratorModel({ toolRound: 2 })).toBe(modelRouter.ESCALATE_MODEL);
  });
});
