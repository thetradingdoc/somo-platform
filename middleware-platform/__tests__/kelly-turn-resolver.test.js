'use strict';

jest.mock('../services/kelly-agent-service', () => ({
  processTurn: jest.fn(async () => ({ reply: 'legacy', toolsUsed: [] }))
}));

jest.mock('../services/kelly-conversation-graph', () => ({
  shouldUseKellyGraph: jest.fn(() => true)
}));

jest.mock('../services/kelly-conversation-bridge', () => ({
  runKellyConversationTurn: jest.fn(async () => ({ reply: 'hybrid', toolsUsed: [] }))
}));

const mockHandleTurn = jest.fn(async () => ({
  reply: 'v2',
  toolsUsed: [],
  kelly_rails: { active_lane: 'clinical', step: 'clinical_intake' }
}));

jest.mock('../services/kelly-rails/orchestrator', () => ({
  handleTurn: (...args) => mockHandleTurn(...args)
}));

jest.mock('../database', () => ({
  insertKellyCallEvent: jest.fn(),
  getKellySessionLanguage: jest.fn(() => null),
  upsertKellySessionLanguage: jest.fn()
}));

const KellyAgentService = require('../services/kelly-agent-service');
const { runKellyConversationTurn } = require('../services/kelly-conversation-bridge');
const { runKellyTurn } = require('../services/kelly-turn-resolver');

describe('kelly-turn-resolver runtime selection', () => {
  const env = { ...process.env };

  afterEach(() => {
    process.env = { ...env };
    jest.clearAllMocks();
  });

  test('uses v2 orchestrator when KELLY_RAILS_V2=1 and does not call processTurn', async () => {
    process.env.KELLY_RAILS_V2 = '1';
    delete process.env.KELLY_ALLOW_HYBRID_GRAPH;

    const out = await runKellyTurn({
      sessionId: 'sess-v2',
      clinicId: 'c1',
      message: 'I have a rash'
    });

    expect(mockHandleTurn).toHaveBeenCalled();
    expect(KellyAgentService.processTurn).not.toHaveBeenCalled();
    expect(runKellyConversationTurn).not.toHaveBeenCalled();
    expect(out.reply).toBe('v2');
  });

  test('uses hybrid when v2 off and KELLY_ALLOW_HYBRID_GRAPH=1', async () => {
    delete process.env.KELLY_RAILS_V2;
    process.env.NODE_ENV = 'test';
    process.env.KELLY_ALLOW_HYBRID_GRAPH = '1';

    const out = await runKellyTurn({
      sessionId: 'sess-hybrid',
      message: 'hello'
    });

    expect(runKellyConversationTurn).toHaveBeenCalled();
    expect(KellyAgentService.processTurn).not.toHaveBeenCalled();
    expect(out.reply).toBe('hybrid');
  });
});
