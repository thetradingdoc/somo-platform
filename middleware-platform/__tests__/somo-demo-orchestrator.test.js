'use strict';

function loadOrchestrator() {
  return require('../services/somo-demo-orchestrator');
}

describe('somo-demo-orchestrator', () => {
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
    persona_name: 'Kelly',
    use_case_label: 'Medical Clinic'
  };

  test('advanceStage moves toward CTA on signup intent', () => {
    const { advanceStage } = loadOrchestrator();
    expect(advanceStage('VALUE', 'can you text me a signup link')).toBe('CTA');
  });

  test('processTurn without Groq returns Kelly qualification reply', async () => {
    const { processTurn } = loadOrchestrator();
    const result = await processTurn({
      userMessage: 'hi',
      stage: 'OPEN',
      context: ctx,
      conversationHistory: [],
      elapsedSec: 10,
      maxDurationSec: 180
    });
    expect(result.reply).toMatch(/Kelly|Somo|practice|good time/i);
    expect(result.stage).toBeTruthy();
  });

  test('processTurn forces end at max duration with wrap message', async () => {
    const { processTurn } = loadOrchestrator();
    const result = await processTurn({
      userMessage: 'still here',
      stage: 'VALUE',
      context: ctx,
      conversationHistory: [],
      elapsedSec: 200,
      maxDurationSec: 180
    });
    expect(result.endCall).toBe(true);
    expect(result.toolCalls.some((t) => t.name === 'end_call')).toBe(true);
  });

  test('ruleBasedReply uses prospect first name and Kelly', () => {
    const { ruleBasedReply } = loadOrchestrator();
    const line = ruleBasedReply('OPEN', ctx);
    expect(line).toMatch(/Alex/);
    expect(line).toMatch(/Kelly/);
  });

  test('ruleBasedReply Spanish when detected_language is es', () => {
    const { ruleBasedReply } = loadOrchestrator();
    const line = ruleBasedReply('QUALIFY', { ...ctx, detected_language: 'es' });
    expect(line).toMatch(/consultorio|dental|médico/i);
  });

  test('record_interest tool includes extended qualification fields', () => {
    const { DEMO_TOOLS } = loadOrchestrator();
    const rec = DEMO_TOOLS.find((t) => t.function.name === 'record_interest');
    const props = rec.function.parameters.properties;
    expect(props.practice_type).toBeDefined();
    expect(props.practice_specialty).toBeDefined();
    expect(props.primary_problem).toBeDefined();
    expect(props.practice_size).toBeDefined();
    expect(props.language_detected).toBeDefined();
  });
});
