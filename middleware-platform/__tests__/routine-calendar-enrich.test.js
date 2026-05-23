'use strict';

const { enrichRoutineCalendarDay, resolvePhaseBand, resolveMilestoneLabel } = require('../lib/routine-calendar-enrich');

describe('routine-calendar-enrich', () => {
  test('resolvePhaseBand marks purge window', () => {
    expect(resolvePhaseBand(4, 'weeks_3_4', 'acne', true)).toBe('purge');
    expect(resolvePhaseBand(1, 'weeks_1_2', 'acne', false)).toBe('intro');
  });

  test('resolveMilestoneLabel for purge without media', () => {
    expect(resolveMilestoneLabel(4, 'weeks_3_4', 'acne', true, false)).toBe('Purging likely');
  });

  test('enrichRoutineCalendarDay adds phase fields', () => {
    const concernRoutineService = require('../services/concern-routine-service');
    const program = concernRoutineService.getConcernProgram('acne');
    const day = enrichRoutineCalendarDay(
      { date: '2026-01-20', is_routine_day: true, has_entry: false, has_media: false },
      { careProgram: program, tplStartIso: '2026-01-01', concernId: 'acne', entryRow: null }
    );
    expect(day.program_week).toBeGreaterThanOrEqual(3);
    expect(day.phase_label).toBeTruthy();
    expect(day.phase_band).toBeTruthy();
    expect(day.phase_expect_snippet).toBeTruthy();
    expect(typeof day.is_purge_window).toBe('boolean');
  });
});
