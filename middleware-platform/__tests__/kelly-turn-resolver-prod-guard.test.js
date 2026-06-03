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

jest.mock('../services/kelly-rails/orchestrator', () => ({
  handleTurn: jest.fn(async () => ({ reply: 'v2', toolsUsed: [], kelly_rails: { active_lane: 'clinical' } }))
}));

jest.mock('../database', () => ({
  insertKellyCallEvent: jest.fn(),
  listKellyCallEvents: jest.fn(() => []),
  getKellySessionLanguage: jest.fn(() => null),
  upsertKellySessionLanguage: jest.fn()
}));

const { runKellyTurn } = require('../services/kelly-turn-resolver');

describe('kelly-turn-resolver production runtime lock', () => {
  const env = { ...process.env };

  afterEach(() => {
    process.env = { ...env };
    jest.clearAllMocks();
  });

  test('throws when V2 disabled in production', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.KELLY_RAILS_V2;

    await expect(
      runKellyTurn({ sessionId: 'prod-sess', message: 'hello', channel: 'voice' })
    ).rejects.toMatchObject({ code: 'KELLY_RUNTIME_BLOCKED' });
  });

  test('uses V2 in production even when KELLY_ALLOW_HYBRID_GRAPH=1', async () => {
    const { handleTurn } = require('../services/kelly-rails/orchestrator');
    const { runKellyConversationTurn } = require('../services/kelly-conversation-bridge');
    process.env.NODE_ENV = 'production';
    process.env.KELLY_RAILS_V2 = '1';
    process.env.KELLY_ALLOW_HYBRID_GRAPH = '1';

    await runKellyTurn({ sessionId: 'prod-v2-sess', message: 'rash on leg' });
    expect(handleTurn).toHaveBeenCalled();
    expect(runKellyConversationTurn).not.toHaveBeenCalled();
  });
});
