'use strict';

const {
  clampVoiceReply,
  applyClinicalOpqrstVoiceLine
} = require('../services/voice-reply-formatter');

describe('voice-reply-formatter', () => {
  const prev = process.env.OPQRST_FIELD_GATE_ENABLED;

  afterEach(() => {
    process.env.OPQRST_FIELD_GATE_ENABLED = prev;
  });

  test('clampVoiceReply limits words', () => {
    const long = new Array(40).fill('word').join(' ');
    const out = clampVoiceReply(long, 'en');
    expect(out.split(/\s+/).length).toBeLessThanOrEqual(25);
  });

  test('T-2: gate tangent passthrough keeps LLM reply', () => {
    process.env.OPQRST_FIELD_GATE_ENABLED = '1';
    const llm = 'Sure — your copay is twenty-five dollars.';
    const out = applyClinicalOpqrstVoiceLine(llm, {
      channel: 'voice',
      active_lane: 'clinical',
      locale: 'en',
      _opqrst_gate: {
        userAskedTangent: true,
        shouldScriptVoice: false,
        scriptedLine: 'What makes it better or worse?'
      }
    });
    expect(out).toBe(llm);
  });

  test('T-2: gate scripts only when shouldScriptVoice', () => {
    process.env.OPQRST_FIELD_GATE_ENABLED = '1';
    const llm = 'Thanks for sharing that.';
    const scripted = 'What makes it better or worse?';
    const out = applyClinicalOpqrstVoiceLine(llm, {
      channel: 'voice',
      active_lane: 'clinical',
      locale: 'en',
      _opqrst_gate: {
        userAskedTangent: false,
        shouldScriptVoice: true,
        scriptedLine: scripted
      }
    });
    expect(out).toBe(scripted);
  });

  test('legacy step mapping when flag off (F-1)', () => {
    process.env.OPQRST_FIELD_GATE_ENABLED = '0';
    const out = applyClinicalOpqrstVoiceLine('LLM text', {
      channel: 'voice',
      active_lane: 'clinical',
      step: 'medical_history',
      locale: 'en'
    });
    expect(out).toMatch(/better or worse/i);
  });
});
