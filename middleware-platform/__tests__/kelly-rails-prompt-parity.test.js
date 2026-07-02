'use strict';

const en = require('../services/kelly-rails/prompts/en');
const es = require('../services/kelly-rails/prompts/es');

describe('Kelly Rails prompt parity (first-contact policy + branding)', () => {
  test('en BASE carries name-first, acknowledge-then-ask, and tone', () => {
    expect(en.BASE).toMatch(/name-first/i);
    expect(en.BASE).toMatch(/acknowledg/i);
    expect(en.BASE).toMatch(/warm, confident, and unhurried/i);
  });

  test('en BASE is brand-neutral (no hardcoded Somo)', () => {
    expect(en.BASE).not.toMatch(/somo/i);
  });

  test('en laneSystemPrompt brands only via providerCtx.clinicName', () => {
    const withBrand = en.laneSystemPrompt(
      'basic_intake',
      'identity',
      { session_id: 's1' },
      { clinicName: 'Bright Path Clinic' }
    );
    expect(withBrand).toContain('Bright Path Clinic');
    expect(withBrand).not.toMatch(/somo/i);

    const noBrand = en.laneSystemPrompt('basic_intake', 'identity', { session_id: 's2' }, {});
    expect(noBrand).not.toMatch(/somo/i);
  });

  test('es BASE carries first-contact policy and stays brand-neutral', () => {
    expect(es.BASE).toMatch(/nombre/i);
    expect(es.BASE).toMatch(/sin prisa/i);
    expect(es.BASE).not.toMatch(/somo/i);
  });
});
