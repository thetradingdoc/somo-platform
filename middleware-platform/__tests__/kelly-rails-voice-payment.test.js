'use strict';

jest.mock('../database', () => ({
  getTriageSession: jest.fn(() => null),
  db: null
}));

const mockCall = jest.fn(async ({ tools, channel, maxTokens }) => ({
  content: 'Here is your payment link.',
  tool_calls: []
}));

jest.mock('../services/llm-router', () => ({
  call: (...args) => mockCall(...args)
}));

jest.mock('../services/kelly-tool-executor', () => {
  const meta = {};
  const allTools = [
    { type: 'function', function: { name: 'request_patient_payment' } },
    { type: 'function', function: { name: 'schedule_appointment' } },
    { type: 'function', function: { name: 'get_triage_session' } }
  ];
  return {
    execute: jest.fn(async () => ({ success: true })),
    _getSessionMeta: jest.fn((sid, key) => meta[`${sid}:${key}`] || null),
    _setSessionMeta: jest.fn((sid, key, val) => {
      meta[`${sid}:${key}`] = val;
    }),
    KELLY_TOOLS: allTools
  };
});

jest.mock('../services/kelly-agent-service', () => ({
  KELLY_TOOLS: [
    { type: 'function', function: { name: 'request_patient_payment' } },
    { type: 'function', function: { name: 'schedule_appointment' } },
    { type: 'function', function: { name: 'get_triage_session' } }
  ]
}));

jest.mock('../services/kelly-rails/history', () => ({
  loadHistory: jest.fn(() => []),
  appendHistory: jest.fn()
}));

const { runNodeStep } = require('../services/kelly-rails/node-runner');
const { getAllowedToolNames } = require('../services/kelly-rails/tool-allowlists');
const { KELLY_LANE } = require('../services/kelly-rails/state-schema');

describe('kelly-rails voice payment lane', () => {
  beforeEach(() => {
    mockCall.mockClear();
    delete process.env.KELLY_VOICE_MAX_TOKENS;
  });

  test('voice channel on payment lane uses payment allow-list and voice token budget', async () => {
    const state = {
      active_lane: KELLY_LANE.PAYMENT,
      step: 'pay_invoice',
      flags: { copay_amount: 25 },
      session_id: 'voice-pay-1'
    };
    const ctx = {
      sessionId: 'voice-pay-1',
      clinicId: 'c1',
      patientId: 'p1',
      channel: 'voice',
      message: 'I need to pay my copay',
      callerPhone: '+15551234567'
    };

    await runNodeStep(state, ctx);

    expect(mockCall).toHaveBeenCalled();
    const callArg = mockCall.mock.calls[0][0];
    expect(callArg.channel).toBe('voice');
    expect(callArg.maxTokens).toBeLessThanOrEqual(300);
    expect(callArg.maxTokens).toBeGreaterThan(0);

    const allowed = getAllowedToolNames('payment', 'pay_invoice');
    const toolNames = (callArg.tools || []).map((t) => t.function.name);
    for (const name of toolNames) {
      expect(allowed).toContain(name);
    }
    expect(toolNames).not.toContain('schedule_appointment');
  });
});
