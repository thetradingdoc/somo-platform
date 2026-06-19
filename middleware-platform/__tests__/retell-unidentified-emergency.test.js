'use strict';

const { isEmergency } = require('../services/conversation-mode/intent-detector');
const { getEmergencyResponseIfNeeded } = require('../services/emergency-safety');
const somoDemoHandler = require('../webhooks/somo-demo-handler');

describe('unidentified path emergency scan (ESC-06)', () => {
  test('isEmergency detects chest pain', () => {
    expect(isEmergency('I have severe chest pain')).toBe(true);
  });

  test('getEmergencyResponseIfNeeded returns 911 guidance', () => {
    const r = getEmergencyResponseIfNeeded('I am having chest pain and cannot breathe', 'en');
    expect(r).toBeTruthy();
    expect(r.reply).toMatch(/911|emergency/i);
  });

  test('demo handler wrapper includes toolCalls', () => {
    const r = somoDemoHandler.getEmergencyResponseIfNeeded('chest pain emergency', 'en');
    expect(r?.toolCalls?.[0]?.name).toBe('end_call');
  });

  test('routine booking is not emergency', () => {
    expect(isEmergency('Can I make a booking?')).toBe(false);
    expect(getEmergencyResponseIfNeeded('Can I make a booking?', 'en')).toBeFalsy();
  });
});
