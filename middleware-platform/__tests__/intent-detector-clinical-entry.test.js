'use strict';

const {
  detectIntents,
  primaryIntent,
  hasSymptomEvidence,
  isContactCaptureUtterance,
  isAdminBookingPhrase
} = require('../services/conversation-mode/intent-detector');
const { UserIntent } = require('../services/conversation-mode/conversation-mode-types');
const { CLINICAL_SIGNALS } = require('../services/kelly-rails/state-schema');

describe('intent-detector clinical entry hygiene (I-1, I-7, V-1, V-2)', () => {
  test('booking utterance routes to BOOK not SYMPTOM', () => {
    const msg = 'Can I make a booking?';
    expect(isAdminBookingPhrase(msg)).toBe(true);
    expect(hasSymptomEvidence(msg)).toBe(false);
    const pi = primaryIntent(msg);
    expect(pi.intent).toBe(UserIntent.BOOK);
    expect(pi.intent).not.toBe(UserIntent.SYMPTOM);
  });

  test('email with doctor does not trigger SYMPTOM', () => {
    const msg = 'jeremiah at gmail dot com';
    expect(isContactCaptureUtterance(msg)).toBe(true);
    expect(hasSymptomEvidence(msg)).toBe(false);
    const intents = detectIntents(msg);
    expect(intents.some((i) => i.intent === UserIntent.SYMPTOM)).toBe(false);
  });

  test('real symptom still triggers SYMPTOM', () => {
    const msg = 'I have a rash on my leg that itches';
    expect(hasSymptomEvidence(msg)).toBe(true);
    const pi = primaryIntent(msg);
    expect(pi.intent).toBe(UserIntent.SYMPTOM);
  });

  test('CLINICAL_SIGNALS no longer includes booking/admin tokens', () => {
    for (const token of ['book', 'appointment', 'visit', 'clinic', 'doctor', 'cita']) {
      expect(CLINICAL_SIGNALS).not.toContain(token);
    }
  });

  test('replay: name/email then booking — no false clinical', () => {
    const turns = [
      'Jeremiah',
      'jeremiah at gmail dot com',
      'Can I make a booking?'
    ];
    for (const t of turns) {
      const pi = primaryIntent(t);
      expect(pi.intent).not.toBe(UserIntent.SYMPTOM);
    }
    expect(primaryIntent(turns[2]).intent).toBe(UserIntent.BOOK);
  });
});
