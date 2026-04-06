import { sendLandingAssistantTurn } from './landingAssistantApi';

describe('sendLandingAssistantTurn', () => {
  const origFetch = global.fetch;

  afterEach(() => {
    global.fetch = origFetch;
  });

  it('POSTs JSON body and returns parsed JSON on success', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, reply: 'ok', session_id: 'sid-1' })
    });
    const out = await sendLandingAssistantTurn({
      apiBase: 'http://localhost:4000',
      message: 'hello',
      sessionId: 'abc',
      clinicId: null
    });
    expect(out.reply).toBe('ok');
    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:4000/api/public/landing-assistant/turn',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          message: 'hello',
          session_id: 'abc',
          preferred_language: 'en',
          kelly_flow: 'skincare'
        })
      })
    );
  });

  it('omits kelly_flow when kellyFlow is null', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, reply: 'ok', session_id: 'sid-1' })
    });
    await sendLandingAssistantTurn({
      apiBase: 'http://localhost:4000',
      message: 'hello',
      sessionId: 'abc',
      clinicId: null,
      kellyFlow: null
    });
    expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual({
      message: 'hello',
      session_id: 'abc',
      preferred_language: 'en'
    });
  });

  it('throws on non-OK response', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: 'bad' })
    });
    await expect(
      sendLandingAssistantTurn({
        apiBase: 'http://localhost:4000',
        message: 'x',
        sessionId: 'abc'
      })
    ).rejects.toThrow(/bad/);
  });
});
