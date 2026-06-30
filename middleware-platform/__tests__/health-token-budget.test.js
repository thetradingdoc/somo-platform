'use strict';

const tokenBudget = require('../utils/token-budget');

describe('health session token budget', () => {
  const sessionId = 'test-health-budget-session';

  beforeEach(() => {
    tokenBudget.resetHealthSession(sessionId);
  });

  test('tracks tokens and rag usage per session', () => {
    tokenBudget.addHealthSessionUsage(sessionId, { tokens: 1000, rag: 1 });
    const used = tokenBudget.getHealthSessionUsage(sessionId);
    expect(used.tokens).toBe(1000);
    expect(used.rag).toBe(1);
  });

  test('blocks when token limit exceeded', () => {
    tokenBudget.addHealthSessionUsage(sessionId, { tokens: tokenBudget.HEALTH_SESSION_MAX_TOKENS - 100 });
    expect(tokenBudget.canProceedHealthSession(sessionId, { tokens: 200 })).toBe(false);
  });

  test('blocks when frame limit exceeded', () => {
    tokenBudget.addHealthSessionUsage(sessionId, { frames: tokenBudget.HEALTH_SESSION_MAX_FRAMES });
    expect(tokenBudget.canProceedHealthSession(sessionId, { frames: 1 })).toBe(false);
  });

  test('reset clears session usage', () => {
    tokenBudget.addHealthSessionUsage(sessionId, { tokens: 500, frames: 2 });
    tokenBudget.resetHealthSession(sessionId);
    expect(tokenBudget.getHealthSessionUsage(sessionId).tokens).toBe(0);
  });
});
