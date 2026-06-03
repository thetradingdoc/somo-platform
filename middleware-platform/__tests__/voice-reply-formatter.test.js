'use strict';

const { clampVoiceReply } = require('../services/voice-reply-formatter');

describe('voice-reply-formatter', () => {
  test('clampVoiceReply limits words', () => {
    const long = new Array(40).fill('word').join(' ');
    const out = clampVoiceReply(long, 'en');
    expect(out.split(/\s+/).length).toBeLessThanOrEqual(25);
  });
});
