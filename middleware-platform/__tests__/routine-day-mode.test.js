'use strict';

const {
  resolveRoutineDayMode,
  isPurgeWindowPhase,
  truncateSnippet,
  daysBetweenUtc,
} = require('../lib/routine-day-mode');

describe('routine-day-mode', () => {
  const today = '2026-05-21';

  test('today allows all mutations', () => {
    const m = resolveRoutineDayMode('2026-05-21', today);
    expect(m.mode).toBe('today');
    expect(m.allows_photo).toBe(true);
    expect(m.allows_daily_post).toBe(true);
    expect(m.is_mutable).toBe(true);
  });

  test('yesterday is backfill', () => {
    const m = resolveRoutineDayMode('2026-05-20', today);
    expect(m.mode).toBe('backfill');
    expect(m.allows_photo).toBe(true);
    expect(m.allows_daily_post).toBe(false);
    expect(m.days_ago).toBe(1);
  });

  test('two days ago is still backfill', () => {
    const m = resolveRoutineDayMode('2026-05-19', today);
    expect(m.mode).toBe('backfill');
    expect(m.allows_photo).toBe(true);
    expect(m.days_ago).toBe(2);
  });

  test('three days ago is historical read-only', () => {
    const m = resolveRoutineDayMode('2026-05-18', today);
    expect(m.mode).toBe('historical');
    expect(m.allows_photo).toBe(false);
    expect(m.allows_daily_post).toBe(false);
    expect(m.days_ago).toBe(3);
  });

  test('future dates are not mutable', () => {
    const m = resolveRoutineDayMode('2026-05-25', today);
    expect(m.mode).toBe('historical');
    expect(m.allows_photo).toBe(false);
  });

  test('isPurgeWindowPhase flags acne weeks 3-5', () => {
    expect(isPurgeWindowPhase(4, 'weeks_3_4', 'acne')).toBe(true);
    expect(isPurgeWindowPhase(2, 'weeks_1_2', 'acne')).toBe(false);
  });

  test('truncateSnippet shortens long copy', () => {
    const long = 'a'.repeat(80);
    const out = truncateSnippet(long, 60);
    expect(out.length).toBeLessThanOrEqual(60);
    expect(out.endsWith('…')).toBe(true);
  });

  test('daysBetweenUtc computes delta', () => {
    expect(daysBetweenUtc('2026-05-18', '2026-05-21')).toBe(3);
  });
});
