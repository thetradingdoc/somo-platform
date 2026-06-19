'use strict';

const OpqrstFieldGate = require('../services/opqrst-field-gate');
const { formatVoiceReply } = require('../services/voice-reply-formatter');

describe('OPQRST gate idempotency (T-6)', () => {
  const prev = process.env.OPQRST_FIELD_GATE_ENABLED;

  beforeAll(() => {
    process.env.OPQRST_FIELD_GATE_ENABLED = '1';
  });

  afterAll(() => {
    process.env.OPQRST_FIELD_GATE_ENABLED = prev;
  });

  test('double resolve with filled field does not re-store', () => {
    const triageRow = { onset: '2 days ago', provocation: 'rest helps' };
    const input = {
      triageRow,
      userMessage: 'rest helps',
      lastAssistantText: 'What makes it better or worse?',
      activeLane: 'clinical',
      conversationMode: 'tenant_inbound_clinical',
      activeSubrail: 'opqrst',
      triagePolicy: 'conditional',
      locale: 'en'
    };
    const first = OpqrstFieldGate.resolve(input);
    expect(first.openField).not.toBe('provocation');
    const second = OpqrstFieldGate.resolve(input);
    expect(second.storePayload).toBeNull();
  });

  test('resolve is pure — same inputs same outputs', () => {
    const input = {
      triageRow: { onset: 'today' },
      userMessage: 'walking makes it worse',
      lastAssistantText: 'What makes it better or worse?',
      activeLane: 'clinical',
      conversationMode: 'tenant_inbound_clinical',
      activeSubrail: 'opqrst',
      triagePolicy: 'conditional',
      locale: 'en'
    };
    const a = OpqrstFieldGate.resolve(input);
    const b = OpqrstFieldGate.resolve(input);
    expect(b).toEqual(a);
  });

  test('double formatVoiceReply with gate passthrough is stable', () => {
    process.env.OPQRST_FIELD_GATE_ENABLED = '1';
    const state = {
      channel: 'voice',
      active_lane: 'clinical',
      locale: 'en',
      _opqrst_gate: { userAskedTangent: true, shouldScriptVoice: false }
    };
    const reply = 'Your copay is twenty-five dollars.';
    expect(formatVoiceReply(reply, state)).toBe(reply);
    expect(formatVoiceReply(reply, state)).toBe(reply);
  });
});
