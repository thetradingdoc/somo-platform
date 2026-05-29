'use strict';

// Loaded after env cleared in beforeEach for rule-based path
function loadOrchestrator() {
  return require('../services/dodgecall-demo-orchestrator');
}

describe('dodgecall-demo-orchestrator', () => {
  const origGroq = process.env.GROQ_API_KEY;

  beforeEach(() => {
    delete process.env.GROQ_API_KEY;
    jest.resetModules();
  });

  afterEach(() => {
    if (origGroq !== undefined) process.env.GROQ_API_KEY = origGroq;
    else delete process.env.GROQ_API_KEY;
  });

  const ctx = {
    prospect_name: 'Alex',
    persona_name: 'Sam',
    use_case_label: 'Receptionist'
  };

  test('advanceStage moves toward CTA on signup intent', () => {
    const { advanceStage } = loadOrchestrator();
    expect(advanceStage('VALUE', 'can you text me a signup link')).toBe('CTA');
  });

  test('processTurn without Groq returns rule-based reply', async () => {
    const { processTurn } = loadOrchestrator();
    const result = await processTurn({
      userMessage: 'hi',
      stage: 'OPEN',
      context: ctx,
      conversationHistory: [],
      elapsedSec: 10,
      maxDurationSec: 240
    });
    expect(result.reply).toMatch(/DodgeCall|Sam|business/i);
    expect(result.stage).toBeTruthy();
  });

  test('processTurn forces end at max duration', async () => {
    const { processTurn } = loadOrchestrator();
    const result = await processTurn({
      userMessage: 'still here',
      stage: 'VALUE',
      context: ctx,
      conversationHistory: [],
      elapsedSec: 300,
      maxDurationSec: 240
    });
    expect(result.endCall).toBe(true);
  });

  test('ruleBasedReply uses prospect first name', () => {
    const { ruleBasedReply } = loadOrchestrator();
    const line = ruleBasedReply('OPEN', ctx);
    expect(line).toMatch(/Alex/);
    expect(line).toMatch(/Sam/);
  });
});
