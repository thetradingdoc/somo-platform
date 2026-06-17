'use strict';

const { normalizeForIntentDetection } = require('../services/conversation-mode/asr-normalize');
const { primaryIntent } = require('../services/conversation-mode/intent-detector');
const { UserIntent } = require('../services/conversation-mode/conversation-mode-types');

describe('asr-normalize', () => {
  test('strips fillers for intent detection', () => {
    const { normalized } = normalizeForIntentDetection('um cancel my appointment please');
    expect(normalized).toMatch(/cancel my appointment/i);
    expect(normalized).not.toMatch(/\bum\b/i);
  });

  test('noisy cancel utterance still detects cancel', () => {
    const { normalized } = normalizeForIntentDetection('um cancel my... appointment');
    const intent = primaryIntent(normalized);
    expect(intent.intent).toBe(UserIntent.CANCEL);
  });
});
