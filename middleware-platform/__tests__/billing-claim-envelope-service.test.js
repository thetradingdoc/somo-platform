'use strict';

const {
  resolvePlaceOfService,
  resolveTelehealthModifiers,
  isMedicarePayer
} = require('../services/billing-claim-envelope-service');

describe('billing-claim-envelope-service', () => {
  test('sync_video maps to POS 02', () => {
    expect(resolvePlaceOfService({ visit_mode: 'sync_video' })).toBe('02');
  });

  test('in_person maps to POS 11', () => {
    expect(resolvePlaceOfService({ visit_mode: 'in_person' })).toBe('11');
  });

  test('telehealth commercial gets modifier 95', () => {
    const mods = resolveTelehealthModifiers({
      visit_mode: 'sync_video',
      payer_id: 'BCBS'
    });
    expect(mods).toContain('95');
  });

  test('telehealth Medicare gets modifier GT', () => {
    const mods = resolveTelehealthModifiers({
      visit_mode: 'sync_video',
      payer_id: 'MEDICARE'
    });
    expect(mods).toContain('GT');
  });

  test('isMedicarePayer detects CMS ids', () => {
    expect(isMedicarePayer('CMS')).toBe(true);
    expect(isMedicarePayer('AETNA')).toBe(false);
  });
});
