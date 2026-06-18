'use strict';

const { buildBoundedPromptContext } = require('../services/kelly-rails/prompt-bounding-locale');

describe('prompt-bounding-locale', () => {
  test('locks locale from preferred_language', () => {
    const ctx = buildBoundedPromptContext({
      locale: 'en',
      flags: { preferred_language: 'es', active_subrail: 'booking', active_subrail_step: 'slot_lookup' }
    });
    expect(ctx.locale).toBe('es');
    expect(ctx.localeBlock).toMatch(/Spanish/i);
    expect(ctx.subrailBlock).toMatch(/booking/i);
  });
});
