'use strict';

const fs = require('fs');
const path = require('path');
const {
  buildForwardOrBlockedTwiml,
  buildBlockedTwiml
} = require('../services/billing-access');
const { resolveOverflowNumber } = require('../services/voice-agent-runtime');

describe('billing overflow TwiML', () => {
  test('forwards when transfer number present', () => {
    const twiml = buildForwardOrBlockedTwiml('Please hold.', '+15551234567');
    expect(twiml).toContain('<Dial>');
    expect(twiml).toContain('+15551234567');
    expect(twiml).not.toContain('<Hangup/>');
  });

  test('hangs up when no transfer number', () => {
    const twiml = buildForwardOrBlockedTwiml('Unavailable.', null);
    expect(twiml).toContain('<Hangup/>');
    expect(twiml).not.toContain('<Dial>');
  });

  test('buildBlockedTwiml escapes XML', () => {
    const twiml = buildBlockedTwiml('Test & go');
    expect(twiml).toContain('Test &amp; go');
  });

  test('resolveOverflowNumber returns null when overflow disabled', () => {
    const overflow = resolveOverflowNumber(
      null,
      'clinic-1',
      { phone_number: '+15551234567' },
      { overflow_enabled: false, transfer_number: '+15559876543' }
    );
    expect(overflow).toBeNull();
  });

  test('voice-incoming-handler does not fall back to transferNumber for overflow', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../services/voice-incoming-handler.js'),
      'utf8'
    );
    expect(src).not.toMatch(/overflowNumber\s*\|\|\s*runtime\.transferNumber/);
    expect(src).toMatch(/const overflowTarget = runtime\.overflowNumber;/);
  });
});
