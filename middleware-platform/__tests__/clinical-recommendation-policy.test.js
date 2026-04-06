'use strict';

const {
  validateAssistantText,
  fallbackReply,
  FALLBACK_REPLY,
  FALLBACK_REPLY_ROUTINE_SKINCARE
} = require('../services/clinical-recommendation-policy');

describe('clinical-recommendation-policy', () => {
  test('allows benign education', () => {
    expect(validateAssistantText('You may want to discuss this with your doctor.').ok).toBe(true);
  });

  test('blocks definitive diagnosis phrasing', () => {
    const v = validateAssistantText('You have diabetes and should start insulin today.');
    expect(v.ok).toBe(false);
    expect(fallbackReply(v)).toBe(FALLBACK_REPLY);
  });

  test('blocks prescription-like dosing', () => {
    const v = validateAssistantText('Take 500 mg twice daily for the pain.');
    expect(v.ok).toBe(false);
  });

  test('routineSkincare fallback avoids triage symptom prompt', () => {
    const v = validateAssistantText('You have diabetes and should start insulin today.');
    expect(v.ok).toBe(false);
    const skin = fallbackReply(v, { routineSkincare: true });
    expect(skin).toBe(FALLBACK_REPLY_ROUTINE_SKINCARE);
    expect(skin.toLowerCase()).not.toContain('symptom or concern');
  });
});
