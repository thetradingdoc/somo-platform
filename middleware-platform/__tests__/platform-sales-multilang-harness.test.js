'use strict';

const { FORBIDDEN_PERSONA_RE } = require('../services/conversation-mode/rails/somo-sales-inbound-rail');

function firstAssistantTurn(result) {
  for (const turn of result.transcript || []) {
    const role = String(turn.role || turn.speaker || '').toLowerCase();
    if (role === 'assistant' || role === 'agent' || role === 'kelly') {
      return String(turn.text || turn.reply || '');
    }
  }
  return String(result.finalReply || '');
}

describe('platform sales multilang harness (EN baseline)', () => {
  test('assistant-turn extraction rejects forbidden personas on EN platform sales', () => {
    const result = {
      transcript: [
        { role: 'assistant', text: "Hi, I'm Kelly with Somo — I help dental and medical practices." },
        { role: 'user', text: 'dental office' },
        { role: 'assistant', text: 'What is the biggest challenge today — missed calls, scheduling, or after-hours coverage?' }
      ]
    };
    const first = firstAssistantTurn(result);
    const second = result.transcript[2].text;
    expect(first).toMatch(/Kelly/i);
    expect(first).not.toMatch(FORBIDDEN_PERSONA_RE);
    expect(second).not.toMatch(FORBIDDEN_PERSONA_RE);
  });

  test('documents ES/RU out of scope for platform sales v1', () => {
    expect(process.env.PLATFORM_SALES_MULTILANG_V1).not.toBe('1');
  });
});
