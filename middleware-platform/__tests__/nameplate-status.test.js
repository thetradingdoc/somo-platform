'use strict';

const { resolveKellyNameplate } = require('../services/nameplate-status-service');

describe('nameplate-status-service', () => {
  const db = {};

  test('returns SHADOW when shadow week active and not live', () => {
    const plate = resolveKellyNameplate(db, {
      voiceSettings: { enabled: 1 },
      clinic: { shadow_week_active: 1, pilot_live_at: null }
    });
    expect(plate.nameplate).toBe('SHADOW');
  });

  test('returns PAUSED when disabled', () => {
    const plate = resolveKellyNameplate(db, {
      voiceSettings: { enabled: 0, business_hours: '{}' },
      clinic: { shadow_week_active: 0 }
    });
    expect(plate.nameplate).toBe('PAUSED');
  });

  test('returns LIVE when enabled and in hours', () => {
    const allDay = '00:00-23:59';
    const plate = resolveKellyNameplate(db, {
      voiceSettings: {
        enabled: 1,
        business_hours: JSON.stringify({
          sun: allDay,
          mon: allDay,
          tue: allDay,
          wed: allDay,
          thu: allDay,
          fri: allDay,
          sat: allDay
        })
      },
      clinic: { shadow_week_active: 0, pilot_live_at: '2026-01-01' }
    });
    expect(plate.nameplate).toBe('LIVE');
  });
});
