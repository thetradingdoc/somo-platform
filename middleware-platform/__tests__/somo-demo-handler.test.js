'use strict';

jest.mock('../database', () => ({
  updateSomoDemoRequest: jest.fn(),
  getSomoDemoRequest: jest.fn()
}));

jest.mock('../services/somo-demo-sheets-sync', () => ({
  appendEventLog: jest.fn().mockResolvedValue(true),
  upsertLeadStatus: jest.fn().mockResolvedValue(true)
}));

jest.mock('../services/somo-demo-sms', () => ({
  sendSignupLink: jest.fn().mockResolvedValue({ sent: true })
}));

jest.mock('../services/kelly-rails/language', () => ({
  evaluateFirstTurnLanguage: jest.fn(() => ({
    language: 'en',
    confidence: 0.9,
    forceLanguageHandoff: false
  }))
}));

describe('somo-demo-handler', () => {
  const origEnabled = process.env.SOMO_DEMO_ENABLED;
  const db = require('../database');
  const language = require('../services/kelly-rails/language');
  const sheetsSync = require('../services/somo-demo-sheets-sync');

  afterEach(() => {
    if (origEnabled !== undefined) process.env.SOMO_DEMO_ENABLED = origEnabled;
    else delete process.env.SOMO_DEMO_ENABLED;
    jest.clearAllMocks();
  });

  test('isSomoDemoDemoConnection requires flag and call_type', () => {
    process.env.SOMO_DEMO_ENABLED = '1';
    const { isSomoDemoDemoConnection } = require('../webhooks/somo-demo-handler');

    const demoConn = {
      callMetadata: {
        metadata: { call_type: 'somo_demo' }
      }
    };
    expect(isSomoDemoDemoConnection(demoConn)).toBe(true);

    const prodConn = {
      callMetadata: {
        metadata: { call_type: 'inbound' }
      }
    };
    expect(isSomoDemoDemoConnection(prodConn)).toBe(false);
  });

  test('isSomoDemoDemoConnection false when demo disabled', () => {
    process.env.SOMO_DEMO_ENABLED = '0';
    const { isSomoDemoDemoConnection } = require('../webhooks/somo-demo-handler');
    const demoConn = {
      callMetadata: { metadata: { call_type: 'somo_demo' } }
    };
    expect(isSomoDemoDemoConnection(demoConn)).toBe(false);
  });

  test('getEmergencyResponseIfNeeded returns 911 script for chest pain', () => {
    const { getEmergencyResponseIfNeeded } = require('../webhooks/somo-demo-handler');
    const res = getEmergencyResponseIfNeeded('I have chest pain', 'en');
    expect(res).not.toBeNull();
    expect(res.reply).toMatch(/911/);
    expect(res.endCall).toBe(true);
  });

  test('getEmergencyResponseIfNeeded Spanish for breathing emergency', () => {
    const { getEmergencyResponseIfNeeded } = require('../webhooks/somo-demo-handler');
    const res = getEmergencyResponseIfNeeded('no puedo respirar', 'es');
    expect(res.reply).toMatch(/911/);
  });

  test('buildRecordInterestPatch merges fields and use_case', () => {
    const { buildRecordInterestPatch } = require('../webhooks/somo-demo-handler');
    const patch = buildRecordInterestPatch(
      {
        level: 'hot',
        practice_type: 'dental_front_desk',
        practice_specialty: 'Ortho',
        practice_size: '5-10',
        primary_problem: 'after hours',
        notes: 'weekends',
        language_detected: 'es'
      },
      { questions_asked: 'existing note' }
    );
    expect(patch.interest_level).toBe('hot');
    expect(patch.use_case).toBe('dental_front_desk');
    expect(patch.practice_specialty).toBe('Ortho');
    expect(patch.language).toBe('es');
    expect(patch.questions_asked).toContain('after hours');
    expect(patch.questions_asked).toContain('existing note');
  });

  test('handleDemoTranscript persists language on first turn', async () => {
    process.env.SOMO_DEMO_ENABLED = '1';
    language.evaluateFirstTurnLanguage.mockReturnValueOnce({
      language: 'es',
      confidence: 0.9,
      forceLanguageHandoff: false
    });
    db.getSomoDemoRequest.mockReturnValue({
      id: 'req-1',
      name: 'Maria',
      phone: '+15551234567',
      use_case: 'medical_clinic'
    });

    const { handleDemoTranscript } = require('../webhooks/somo-demo-handler');
    const connection = {
      callMetadata: {
        dynamic_variables: {
          call_type: 'somo_demo',
          demo_request_id: 'req-1',
          prospect_name: 'Maria',
          use_case: 'medical_clinic'
        }
      },
      conversationHistory: [],
      startTime: Date.now(),
      _demoStage: 'OPEN',
      ws: { send: jest.fn() }
    };

    await handleDemoTranscript(
      'call-1',
      connection,
      'Hola, sí claro',
      { response_id: 1 },
      jest.fn()
    );

    expect(language.evaluateFirstTurnLanguage).toHaveBeenCalledWith('Hola, sí claro');
    expect(db.updateSomoDemoRequest).toHaveBeenCalledWith(
      'req-1',
      expect.objectContaining({ language: 'es' })
    );
    expect(connection._demoDetectedLanguage).toBe('es');
  });

  test('handleDemoTranscript emergency skips orchestrator and ends call', async () => {
    process.env.SOMO_DEMO_ENABLED = '1';
    db.getSomoDemoRequest.mockReturnValue({
      id: 'req-2',
      name: 'Pat',
      phone: '+15559876543'
    });

    const { handleDemoTranscript } = require('../webhooks/somo-demo-handler');
    const sendFn = jest.fn();
    const connection = {
      callMetadata: {
        dynamic_variables: {
          demo_request_id: 'req-2',
          use_case: 'medical_clinic'
        }
      },
      customerPhone: '+15559876543',
      conversationHistory: [],
      startTime: Date.now(),
      _demoStage: 'OPEN',
      _demoLanguageEvaluated: true,
      _demoDetectedLanguage: 'en',
      ws: { send: jest.fn() }
    };

    await handleDemoTranscript(
      'call-2',
      connection,
      'I have crushing chest pain',
      { response_id: 2 },
      sendFn
    );

    expect(sendFn).toHaveBeenCalledWith(
      connection.ws,
      expect.stringMatching(/911/),
      2
    );
    expect(db.updateSomoDemoRequest).toHaveBeenCalledWith(
      'req-2',
      expect.objectContaining({ outcome: 'completed_agent' })
    );
    expect(sheetsSync.appendEventLog).toHaveBeenCalledWith(
      expect.objectContaining({ event_type: 'call_ended' })
    );
  });
});
