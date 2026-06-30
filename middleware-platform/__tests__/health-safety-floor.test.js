'use strict';

jest.mock('../services/health/agent/orchestrator', () => ({
  processTurn: jest.fn(),
  runHealthTurn: jest.fn()
}));

jest.mock('../services/video-consult-sse', () => ({
  broadcastTranscriptDelta: jest.fn(),
  broadcastAssistantMessage: jest.fn(),
  broadcastAssistantUpdate: jest.fn(),
  broadcastRiskAlert: jest.fn(),
  broadcastToolEvent: jest.fn()
}));

const orchestrator = require('../services/health/agent/orchestrator');
const videoConsultSse = require('../services/video-consult-sse');
const healthTurnService = require('../services/health-turn-service');
const healthSessionService = require('../services/health-session-service');

describe('health safety floor', () => {
  beforeEach(() => {
    orchestrator.processTurn.mockReset();
    videoConsultSse.broadcastRiskAlert.mockReset();
  });

  test('chest pain short-circuits without calling orchestrator', async () => {
    const session = healthSessionService.createSession({ termsAccepted: true });
    const result = await healthTurnService.processOneTurn(
      session.room_id,
      'I have severe chest pain and trouble breathing',
      { speaker: 'patient', source: 'test' }
    );

    expect(result.success).toBe(true);
    expect(orchestrator.processTurn).not.toHaveBeenCalled();
    expect(videoConsultSse.broadcastRiskAlert).toHaveBeenCalled();
    const lines = healthSessionService.listTranscripts(session.id);
    expect(lines.some((l) => l.speaker === 'assistant' && /emergency|911|999/i.test(l.text))).toBe(true);

    const updated = healthSessionService.getById(session.id);
    expect(updated.metadata?.safety_flags?.length).toBeGreaterThan(0);
  });

  test('self-harm language triggers emergency path', async () => {
    const session = healthSessionService.createSession({ termsAccepted: true });
    await healthTurnService.processOneTurn(session.room_id, 'I have been having thoughts of suicide', {
      speaker: 'patient',
      source: 'test'
    });
    expect(orchestrator.processTurn).not.toHaveBeenCalled();
  });

  test('diagnosis language in orchestrator reply is sanitized', async () => {
    const session = healthSessionService.createSession({ termsAccepted: true });
    orchestrator.processTurn.mockResolvedValue({
      text: 'You have eczema and this is a diagnosis of dermatitis.',
      toolEvents: [],
      safety: { emergency: false, flags: [] },
      meta: {}
    });

    const result = await healthTurnService.processOneTurn(session.room_id, 'itchy rash on arm', {
      speaker: 'patient',
      source: 'test'
    });

    expect(result.success).toBe(true);
    expect(result.reply).not.toMatch(/you have eczema/i);
    expect(result.reply).toMatch(/clinician|professional/i);
    const lines = healthSessionService.listTranscripts(session.id);
    const assistant = lines.filter((l) => l.speaker === 'assistant').pop();
    expect(assistant.text).not.toMatch(/you have eczema/i);
  });
});
