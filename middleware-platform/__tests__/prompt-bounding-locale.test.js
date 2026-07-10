'use strict';

const { buildBoundedPromptContext } = require('../services/kelly-rails/prompt-bounding-locale');

describe('prompt-bounding-locale', () => {
  test('locks locale from projection.flags_json.locale', () => {
    const ctx = buildBoundedPromptContext({
      locale: 'en',
      flags: { locale: 'es', active_subrail: 'booking', active_subrail_step: 'slot_lookup' }
    });
    expect(ctx.locale).toBe('es');
    expect(ctx.localeBlock).toMatch(/Spanish/i);
    expect(ctx.subrailBlock).toMatch(/booking/i);
  });
});
