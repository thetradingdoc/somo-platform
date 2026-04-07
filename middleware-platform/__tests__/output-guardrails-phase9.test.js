'use strict';

const { applyOutputGuardrails } = require('../services/clinical-recommendation-policy');

describe('phase9 output guardrails', () => {
  test('suppresses commercial copy when safety is non-green', () => {
    const out = applyOutputGuardrails('You can add to cart and checkout now.', { safetyStatus: 'yellow' });
    expect(out.toLowerCase()).toContain('prioritize clinical safety');
  });

  test('falls back on forbidden diagnosis text', () => {
    const out = applyOutputGuardrails('You definitely have melanoma.', { safetyStatus: 'green' });
    expect(out.toLowerCase()).toContain('cannot give a definitive diagnosis');
  });
});
