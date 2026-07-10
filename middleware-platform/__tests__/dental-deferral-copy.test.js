'use strict';

const copy = require('../../Knowledge/rules/coding-deferral-copy.json');
const { classifyPayerContext } = require('../services/payer-class-routing');

describe('C-DF honest deferral copy', () => {
  test('SSOT deferral messages exist', () => {
    expect(copy.CODE_NOT_IN_STARTER_SET).toMatch(/call you back/i);
    expect(copy.PAYER_NOT_SEEDED).toMatch(/front desk/i);
    expect(copy.PROVIDER_LOCATION_DEFER).toMatch(/provider and location/i);
  });

  test('DENTAL-015 payer-not-seeded scenario metadata', () => {
    const { DENTAL_PSTN_SCENARIOS } = require('../e2e/scenario-registry/dental-front-desk.cjs');
    const s = DENTAL_PSTN_SCENARIOS.find((x) => x.id === 'DENTAL-015');
    expect(s).toBeTruthy();
    expect(s.payer_not_seeded).toBe(true);
    expect(s.assertions).toContain('PAYER_NOT_SEEDED');
    expect(s.assertions).toContain('DESK_CALLBACK');
  });

  test('medical payer on dental tenant maps to mismatch', () => {
    const r = classifyPayerContext({
      payerId: 'BCBS_PILOT',
      planId: 'plan_x',
      tenantSpecialty: 'Dental'
    });
    expect(r.message_key).toBe('PAYER_CLASS_MISMATCH');
  });
});
