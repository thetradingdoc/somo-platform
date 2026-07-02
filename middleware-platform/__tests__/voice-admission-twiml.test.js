'use strict';

const { buildAdmissionTwiml } = require('../services/voice-admission-twiml');

describe('voice-admission-twiml', () => {
  test('forward_pstn includes Dial with transfer number', () => {
    const xml = buildAdmissionTwiml({
      allowed: false,
      action: 'forward_pstn',
      message: 'Connecting you now.',
      transferNumber: '+15551234567'
    });
    expect(xml).toContain('<Dial>+15551234567</Dial>');
    expect(xml).toContain('Connecting you now.');
    expect(xml).not.toContain('<Hangup/>');
  });

  test('hangup omits Dial', () => {
    const xml = buildAdmissionTwiml({
      allowed: false,
      action: 'hangup',
      message: 'We are closed.'
    });
    expect(xml).not.toContain('<Dial>');
    expect(xml).toContain('<Hangup/>');
  });
});
