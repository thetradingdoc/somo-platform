'use strict';

const stedi271Parser = require('../../services/stedi-271-parser');

describe('stedi-271-parser AAA extraction', () => {
  test('extractAaaErrors reads top-level errors', () => {
    const aaa = stedi271Parser.extractAaaErrors({
      errors: [{ code: '79', description: 'Invalid participant ID' }],
    });
    expect(aaa.codes).toContain('79');
    expect(aaa.messages[0]).toMatch(/Invalid participant/i);
  });

  test('parse271Response surfaces AAA on empty benefits', () => {
    const parsed = stedi271Parser.parse271Response({
      errors: [{ code: '71', description: 'Subscriber DOB mismatch' }],
    });
    expect(parsed.eligible).toBe(false);
    expect(parsed.aaaCodes).toContain('71');
    expect(parsed.message).toMatch(/DOB/i);
  });
});
