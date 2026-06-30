'use strict';

const healthTurnService = require('../services/health-turn-service');
const healthSessionService = require('../services/health-session-service');
const healthVideoOpqrst = require('../services/health-video-opqrst');
const { recommendPathway } = require('../services/health-care-pathway');

jest.mock('../services/health/agent/orchestrator', () => ({
  processTurn: jest.fn(),
  runHealthTurn: jest.fn()
}));

const orchestrator = require('../services/health/agent/orchestrator');

describe('health-turn-service', () => {
  beforeEach(() => {
    orchestrator.processTurn.mockReset();
    orchestrator.processTurn.mockResolvedValue({
      text: 'Thanks for sharing. Can you tell me more?',
      toolEvents: [],
      safety: { emergency: false, flags: [] },
      meta: {}
    });
  });

  test('persists patient and assistant transcript lines', async () => {
    const session = healthSessionService.createSession({ termsAccepted: true });
    await healthTurnService.processPatientTurn(session.room_id, 'I have a rash', {
      speaker: 'patient',
      is_final: true,
      source: 'test'
    });
    const lines = healthSessionService.listTranscripts(session.id);
    expect(lines.some((l) => l.speaker === 'patient' && l.text.includes('rash'))).toBe(true);
    expect(lines.some((l) => l.speaker === 'assistant')).toBe(true);
  });

  test('buildHistoryFromDb includes prior turns', async () => {
    const session = healthSessionService.createSession({ termsAccepted: true });
    orchestrator.processTurn
      .mockResolvedValueOnce({
        text: 'When did it start?',
        toolEvents: [],
        safety: { emergency: false, flags: [] },
        meta: {}
      })
      .mockResolvedValueOnce({
        text: 'You mentioned a rash — any fever?',
        toolEvents: [],
        safety: { emergency: false, flags: [] },
        meta: {}
      });

    await healthTurnService.processPatientTurn(session.room_id, 'rash on my arm', {
      speaker: 'patient',
      is_final: true
    });
    await healthTurnService.processPatientTurn(session.room_id, 'two days ago', {
      speaker: 'patient',
      is_final: true
    });

    const history = healthTurnService.buildHistoryFromDb(session.id);
    expect(history.length).toBeGreaterThanOrEqual(3);
    expect(history.some((h) => h.content.includes('rash'))).toBe(true);
  });

  test('three sequential patient turns persist in strict timestamp order', async () => {
    const session = healthSessionService.createSession({ termsAccepted: true });
    const texts = ['rash on my neck', 'started three days ago', 'no fever'];

    for (const text of texts) {
      await healthTurnService.processPatientTurn(session.room_id, text, {
        speaker: 'patient',
        is_final: true,
        source: 'test'
      });
    }

    const lines = healthSessionService.listTranscripts(session.id);
    const patientLines = lines.filter((l) => l.speaker === 'patient');
    expect(patientLines).toHaveLength(3);
    expect(patientLines.map((l) => l.text)).toEqual(texts);

    for (let i = 1; i < lines.length; i++) {
      expect(new Date(lines[i].ts).getTime()).toBeGreaterThanOrEqual(new Date(lines[i - 1].ts).getTime());
    }

    const speakers = lines.map((l) => l.speaker);
    expect(speakers.filter((s) => s === 'patient')).toHaveLength(3);
    expect(speakers.filter((s) => s === 'assistant')).toHaveLength(3);
  });

  test('turn 3 orchestrator receives history from turn 1', async () => {
    const session = healthSessionService.createSession({ termsAccepted: true });
    orchestrator.processTurn.mockResolvedValue({
      text: 'Tell me more.',
      toolEvents: [],
      safety: { emergency: false, flags: [] },
      meta: {}
    });

    await healthTurnService.processPatientTurn(session.room_id, 'rash on my neck for 3 days', {
      speaker: 'patient',
      is_final: true
    });
    await healthTurnService.processPatientTurn(session.room_id, 'no fever', {
      speaker: 'patient',
      is_final: true
    });
    await healthTurnService.processPatientTurn(session.room_id, 'mild itch', {
      speaker: 'patient',
      is_final: true
    });

    const lastCall = orchestrator.processTurn.mock.calls[orchestrator.processTurn.mock.calls.length - 1][0];
    const historyText = (lastCall.history || []).map((h) => h.content).join(' ');
    expect(historyText).toMatch(/rash on my neck/i);
  });
});

describe('health-video-opqrst negations', () => {
  test('parses fever absent', () => {
    const meta = healthVideoOpqrst.updateFromUtterance({}, 'I have a rash but no fever');
    expect(meta.negations.fever_absent).toBe(true);
  });
});

describe('health-care-pathway', () => {
  test('rash without fever suggests routine not emergency', () => {
    const meta = healthVideoOpqrst.updateFromUtterance({}, 'rash on arm, no fever');
    const pathway = recommendPathway({ metadata: meta, safetyFlags: [] });
    expect(pathway.urgency).not.toBe('emergency');
  });
});
