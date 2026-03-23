const mockCreate = jest.fn();

jest.mock('groq-sdk', () => {
  return jest.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: (...args) => mockCreate(...args)
      }
    }
  }));
});

jest.mock('@anthropic-ai/sdk', () => {
  return jest.fn().mockImplementation(() => ({
    messages: {
      create: jest.fn()
    }
  }));
});

describe('LLMRouter Groq 413 compaction (B3)', () => {
  beforeEach(() => {
    jest.resetModules();
    mockCreate.mockReset();
    process.env.GROQ_API_KEY = 'test-key';
    process.env.KELLY_PRIMARY_PROVIDER = 'groq';
    process.env.KELLY_GROQ_MAX_RETRIES = '2';
    process.env.KELLY_GROQ_RETRY_BASE_MS = '1';
    process.env.KELLY_GROQ_MODEL = 'llama-3.3-70b-versatile';
    process.env.KELLY_GROQ_FALLBACK_MODEL = 'llama-3.1-8b-instant';
  });

  it('retries 413 with compact prompt and last 4 messages', async () => {
    const err = new Error('Request too large');
    err.status = 413;
    mockCreate
      .mockRejectedValueOnce(err)
      .mockResolvedValueOnce({ choices: [{ message: { content: 'ok' } }] });

    const LLMRouter = require('../services/llm-router');

    const messages = [
      { role: 'system', content: 'X'.repeat(2000) },
      { role: 'user', content: 'm1' },
      { role: 'assistant', content: 'm2' },
      { role: 'user', content: 'm3' },
      { role: 'assistant', content: 'm4' },
      { role: 'user', content: 'm5' },
      { role: 'assistant', content: 'm6' }
    ];

    await LLMRouter.call({
      messages,
      tools: [],
      maxTokens: 64,
      channel: 'voice',
      forceProvider: 'groq'
    });

    expect(mockCreate).toHaveBeenCalledTimes(2);

    const firstPayload = mockCreate.mock.calls[0][0];
    const secondPayload = mockCreate.mock.calls[1][0];

    expect(firstPayload.model).toBe('llama-3.3-70b-versatile');
    expect(firstPayload.messages.length).toBe(7);

    expect(secondPayload.model).toBe('llama-3.1-8b-instant');
    // 1 compacted system + last 4 non-system messages
    expect(secondPayload.messages.length).toBe(5);
    expect(secondPayload.messages[0].role).toBe('system');
    expect(String(secondPayload.messages[0].content).length).toBeLessThan(1000);
    expect(secondPayload.messages.slice(1).map((m) => m.content)).toEqual(['m3', 'm4', 'm5', 'm6']);
  });
});
