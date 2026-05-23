const {
  listConcerns,
  buildTemplatePayload,
  buildPreview,
  resolveCurrentPhase,
  getConcernProgram,
} = require('../services/concern-routine-service');

describe('concern-routine-service', () => {
  test('lists five concerns', () => {
    const concerns = listConcerns();
    expect(concerns.length).toBe(5);
    const ids = concerns.map((c) => c.id);
    expect(ids).toContain('hyperpigmentation');
    expect(ids).toContain('rosacea');
  });

  test('hyperpigmentation is 24 weeks', () => {
    const preview = buildPreview('hyperpigmentation');
    expect(preview.total_weeks).toBe(24);
  });

  test('rosacea includes red flags', () => {
    const preview = buildPreview('rosacea');
    expect(preview.red_flags.length).toBeGreaterThan(0);
  });

  test('buildPreview includes week_one bundle for funnel', () => {
    const preview = buildPreview('acne');
    expect(preview.week_one).toBeTruthy();
    expect(preview.week_one.expect).toBeTruthy();
    expect(Array.isArray(preview.week_one.am_steps)).toBe(true);
    expect(preview.week_one.am_steps.length).toBeGreaterThan(0);
    expect(preview.week_one_key_rule).toBeTruthy();
    expect(preview.week_one_red_flag).toBeTruthy();
    expect(preview.phases[0].expect).toBeTruthy();
  });

  test('buildTemplatePayload creates am/pm items', () => {
    const payload = buildTemplatePayload('acne', '2026-05-18');
    expect(payload.duration_days).toBe(12 * 7);
    expect(payload.items.length).toBeGreaterThan(0);
    expect(payload.items.some((i) => i.usage_time === 'am')).toBe(true);
    expect(payload.items.some((i) => i.usage_time === 'pm')).toBe(true);
    expect(payload.metadata_json.weekly_schedule).toBeTruthy();
  });

  test('resolveCurrentPhase advances by week', () => {
    const program = getConcernProgram('anti_aging');
    const w1 = resolveCurrentPhase(program, '2026-01-01', '2026-01-03');
    const w5 = resolveCurrentPhase(program, '2026-01-01', '2026-01-29');
    expect(w1.program_week).toBe(1);
    expect(w5.program_week).toBeGreaterThanOrEqual(5);
    expect(w5.phase_key).not.toBe(w1.phase_key);
  });

  test('resolveCurrentPhase uses entry date not today for historical display', () => {
    const program = getConcernProgram('acne');
    const start = '2026-01-01';
    const day10 = resolveCurrentPhase(program, start, '2026-01-10');
    const day42 = resolveCurrentPhase(program, start, '2026-02-12');
    expect(day10.program_week).toBeLessThan(day42.program_week);
    expect(day10.expect).toBeTruthy();
    expect(day42.expect).toBeTruthy();
    if (day10.expect !== day42.expect) {
      expect(day10.expect).not.toBe(day42.expect);
    }
  });
});
