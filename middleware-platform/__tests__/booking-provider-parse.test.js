'use strict';

const { parseProviderFromMessage } = require('../services/conversation-mode/subrails/booking-subrail');

describe('parseProviderFromMessage', () => {
  test('parses Dr Martinez', () => {
    expect(parseProviderFromMessage('I want to see Dr Martinez')).toMatch(/martinez/i);
  });

  test('parses with clause', () => {
    expect(parseProviderFromMessage('book with Maria Santos')).toBe('Maria Santos');
  });
});
