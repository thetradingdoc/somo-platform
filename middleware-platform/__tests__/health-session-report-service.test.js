'use strict';

describe('health-session-report-service', () => {
  const prevGroq = process.env.GROQ_API_KEY;
  let healthSessionReport;
  let healthSessionService;
  let healthVideoOpqrst;

  beforeAll(() => {
    jest.resetModules();
    delete process.env.GROQ_API_KEY;
    healthSessionReport = require('../services/health-session-report-service');
    healthSessionService = require('../services/health-session-service');
    healthVideoOpqrst = require('../services/health-video-opqrst');
  });

  afterAll(() => {
    if (prevGroq) process.env.GROQ_API_KEY = prevGroq;
  });

  test('buildPatientReport includes chief complaint, opqrst, and both speakers', async () => {
    const session = healthSessionService.createSession({
      termsAccepted: true
    });
    const opqrstMeta = healthVideoOpqrst.updateFromUtterance({}, 'rash on neck for 3 days, no fever');
    healthSessionService.updateMetadata(session.id, {
      ...opqrstMeta,
      safety_flags: [{ rule_id: 'test', level: 'info' }]
    });

    healthSessionService.persistTranscript(session.id, session.room_id, {
      speaker: 'patient',
      text: 'I have a rash on my neck for 3 days',
      source: 'test'
    });
    healthSessionService.persistTranscript(session.id, session.room_id, {
      speaker: 'assistant',
      text: 'Thanks for sharing. Any fever?',
      source: 'kelly_pa'
    });

    const report = await healthSessionReport.buildPatientReport(session.room_id);

    expect(report.chief_complaint).toMatch(/rash/i);
    expect(report.opqrst).toBeTruthy();
    expect(report.safety_flags).toHaveLength(1);
    expect(report.transcript_excerpt).toMatch(/patient:/i);
    expect(report.transcript_excerpt).toMatch(/assistant:/i);
  });

  test('report summary is not a patient-only monologue when assistant spoke', async () => {
    const session = healthSessionService.createSession({ termsAccepted: true });
    healthSessionService.persistTranscript(session.id, session.room_id, {
      speaker: 'patient',
      text: 'rash on arm',
      source: 'test'
    });
    healthSessionService.persistTranscript(session.id, session.room_id, {
      speaker: 'assistant',
      text: 'When did it start?',
      source: 'kelly_pa'
    });

    const report = await healthSessionReport.buildPatientReport(session.room_id);
    const excerpt = report.transcript_excerpt || '';
    const patientOnly = excerpt.split('\n').filter((l) => /^(patient|user):/i.test(l)).join('\n');
    expect(excerpt).toMatch(/assistant:/i);
    expect(report.summary || excerpt).not.toBe(patientOnly.trim());
  });
});
